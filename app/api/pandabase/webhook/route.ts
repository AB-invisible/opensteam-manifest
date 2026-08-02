import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { verifyPandabaseWebhook, type PandabaseWebhookEvent } from "@/app/lib/pandabase";

/** Plans billed as recurring subscriptions (expiry driven by subscription events). */
const SUBSCRIPTION_PLANS = new Set(["BUSINESS"]);

export async function POST(req: NextRequest) {
  const body = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let webhookData: PandabaseWebhookEvent;
  try {
    webhookData = verifyPandabaseWebhook(body, headers);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const eventType = webhookData.event;
    const data = webhookData.data || ({} as PandabaseWebhookEvent["data"]);
    const order = data.order || ({} as any);
    const metadata = order.metadata || {};
    const subscription = data.subscription;

    const userId = metadata.userId;
    const planName = metadata.planName;
    const purchaseType = metadata.purchaseType;
    const productId = metadata.productId;
    const orderId = order.id ? String(order.id) : null;

    // --- Successful payment / activation events ---
    if (
      eventType === "PAYMENT_COMPLETED" ||
      eventType === "SUBSCRIPTION_CREATED" ||
      eventType === "SUBSCRIPTION_RENEWED"
    ) {
      // Steam account purchases (one-time) are only fulfilled on payment.
      if (
        purchaseType === "steam_account" &&
        userId &&
        productId &&
        eventType === "PAYMENT_COMPLETED"
      ) {
        const { getSteamAccountProduct } = await import("@/app/lib/steam-accounts-shop");
        const { fulfillSteamAccountOrder } = await import("@/app/lib/steam-account-delivery");
        const product = getSteamAccountProduct(String(productId));

        const existing = orderId
          ? await prisma.steamAccountOrder.findUnique({ where: { pandabaseOrderId: orderId } })
          : null;

        if (!existing) {
          const newOrder = await prisma.steamAccountOrder.create({
            data: {
              userId,
              productId: String(productId),
              pandabaseOrderId: orderId,
              status: "PAID",
            },
          });

          await fulfillSteamAccountOrder(newOrder.id).catch((e) =>
            console.error("[Pandabase Webhook] Steam account delivery failed:", e)
          );

          const user = await prisma.user.findUnique({ where: { id: userId } });
          if (user) {
            const { sendBotDM } = await import("@/app/lib/bot-admin");
            const { sendBrandedEmail } = await import("@/app/lib/email");
            const label = product?.name ?? String(productId);

            if (user.discordId) {
              await sendBotDM(user.discordId, "", {
                title: "Steam Account Order Confirmed",
                description: `Your **${label}** Steam account order is confirmed. We will deliver your login credentials as soon as fulfillment completes.`,
                color: 0x10b981,
                footer: { text: "OpenSteam Shop" },
              }).catch(() => {});
            }

            if (user.email) {
              await sendBrandedEmail(
                user.email,
                `OpenSteam Shop — ${label} order confirmed`,
                "Order Confirmed",
                `Your <strong>${label}</strong> Steam account order is confirmed. Login credentials will be delivered after fulfillment completes.`,
                "#10b981",
                undefined,
                { buttonText: "Visit Shop", buttonUrl: "https://opensteam.mysellauth.com/" }
              ).catch(() => {});
            }
          }

          console.log(`[Pandabase Webhook] Steam account order created for user ${userId}, product ${productId}`);
        }

        return NextResponse.json({ success: true });
      }

      if (userId && planName) {
        if (planName === "UNBAN") {
          // Reactivation is a one-time payment — only act on the payment event.
          if (eventType !== "PAYMENT_COMPLETED") {
            return NextResponse.json({ success: true });
          }

          const { unbanUserGlobally } = await import("@/app/lib/ratelimit");
          await unbanUserGlobally(userId);

          await prisma.sentinelLog.create({
            data: {
              userId,
              action: "APPEAL_ACCEPTED",
              score: 0,
              reason: "Reactivated account by purchasing unban fee via Pandabase Checkout.",
              details: JSON.stringify({ source: "PandabaseWebhookPayment", orderId }),
            },
          });

          const user = await prisma.user.findUnique({ where: { id: userId } });
          if (user) {
            const { sendBotDM } = await import("@/app/lib/bot-admin");
            const { sendBrandedEmail } = await import("@/app/lib/email");

            if (user.discordId) {
              await sendBotDM(user.discordId, "", {
                title: "🎉 Account Reactivated Successfully",
                description: `Your OpenSteam account has been successfully unbanned and reactivated! All associated API keys are re-enabled, and firewall blocks have been cleared. Welcome back!`,
                color: 0x10b981,
                footer: { text: "OpenSteam Network Security" },
              }).catch(() => {});
            }

            if (user.email) {
              await sendBrandedEmail(
                user.email,
                "OpenSteam — Account Reactivated Successfully",
                "🟢 Account Reactivated",
                `Hello <strong>${user.username}</strong>,<br><br>Your OpenSteam account has been successfully unbanned and reactivated! All associated API keys are now active, and local firewall blocks have been cleared.<br><br>You can safely log back into the dashboard now.`,
                "#10b981",
                undefined,
                { buttonText: "Go to Dashboard", buttonUrl: "http://127.0.0.1:3000/dashboard" }
              ).catch(() => {});
            }
          }

          console.log(`[Pandabase Webhook] Successfully unbanned user ${userId} via paid checkout.`);
          return NextResponse.json({ success: true });
        }

        // --- Plan activation / renewal ---
        const isSubscriptionPlan = SUBSCRIPTION_PLANS.has(planName);
        const expirationDate = subscription?.currentPeriodEnd
          ? new Date(subscription.currentPeriodEnd)
          : null;

        const user = await prisma.user.findUnique({ where: { id: userId } });

        // Update plan. Only touch expiry when we have an authoritative value
        // (subscription events) so a same-cycle PAYMENT_COMPLETED doesn't wipe it.
        await prisma.user.update({
          where: { id: userId },
          data: {
            plan: planName as any,
            planIsCanceled: false,
            ...(isSubscriptionPlan
              ? expirationDate
                ? { planExpiry: expirationDate }
                : {}
              : { planExpiry: null }),
          },
        });

        const { upsertHostedBotInstanceForUser } = await import("@/app/lib/hosted-bot");
        await upsertHostedBotInstanceForUser(userId, planName as any).catch((e) =>
          console.error("[Pandabase Webhook] Hosted bot upsert failed:", e)
        );

        const expiryStr = expirationDate
          ? expirationDate.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })
          : null;

        const { sendBotDM } = await import("@/app/lib/bot-admin");
        const { sendEmail, sendBrandedEmail } = await import("@/app/lib/email");

        if (eventType === "PAYMENT_COMPLETED" && user) {
          // --- Payment receipt: DM + email with attached PDF ---
          if (user.discordId) {
            await sendBotDM(user.discordId, "", {
              title: "Payment Confirmed",
              description: `Your **${planName}** plan is now active.${expiryStr ? `\n\n**Valid until:** ${expiryStr}` : ""}\n\nA receipt has been sent to your email address.`,
              color: 0x10b981,
              footer: { text: "OpenSteam" },
            }).catch((e) => console.error("[Webhook DM Error]", e));
          }

          if (user.email) {
            const { generateReceiptPdf } = await import("@/app/lib/receipt");

            const pdfBuffer = await generateReceiptPdf(user.username, planName, new Date(), expirationDate);
            const purchaseDateStr = new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });

            const bodyHtml = `Your <strong>${planName}</strong> plan is now active.<br><br>`
              + `<strong>Plan:</strong> ${planName}<br>`
              + `<strong>Purchased:</strong> ${purchaseDateStr}<br>`
              + (expiryStr ? `<strong>Valid until:</strong> ${expiryStr}<br>` : "")
              + `<br>Your receipt is attached to this email.`;

            await sendBrandedEmail(
              user.email,
              `OpenSteam ${planName} — Payment Confirmed`,
              "Payment Confirmed",
              bodyHtml,
              "#10b981",
              undefined,
              {
                buttonText: "Go to Dashboard",
                buttonUrl: "http://127.0.0.1:3000/dashboard",
                badge: "Payment Received",
              }
            ).catch((e) => console.error("[Webhook Receipt Email Error]", e));

            await sendEmail(
              user.email,
              `Receipt — OpenSteam ${planName} Plan`,
              `<p style="font-family:sans-serif;color:#94a3b8;font-size:14px;">Hi ${user.username}, your receipt for the ${planName} plan is attached.</p>`,
              [
                {
                  filename: `Receipt_${planName.replace(/\s+/g, "_")}_${Date.now()}.pdf`,
                  content: pdfBuffer,
                  contentType: "application/pdf",
                },
              ]
            ).catch((e) => console.error("[Webhook Receipt PDF Error]", e));
          }
        } else if (user) {
          // --- Subscription created/renewed (no separate payment receipt here) ---
          if (user.discordId) {
            await sendBotDM(user.discordId, "", {
              title: eventType === "SUBSCRIPTION_RENEWED" ? "Subscription Renewed" : "Plan Activated",
              description: `Your **${planName}** plan is now active.${expiryStr ? `\n\n**Valid until:** ${expiryStr}` : ""}`,
              color: 0x10b981,
              footer: { text: "OpenSteam" },
            }).catch((e) => console.error("[Webhook DM Error]", e));
          }
          if (user.email) {
            await sendBrandedEmail(
              user.email,
              `Your OpenSteam ${planName} plan is active`,
              eventType === "SUBSCRIPTION_RENEWED" ? "Subscription Renewed" : "Plan Activated",
              `Your <strong>${planName}</strong> plan is now active.`
                + (expiryStr ? ` Access runs until <strong>${expiryStr}</strong>.` : "")
                + ` You can start using your features immediately from the dashboard.`,
              "#10b981",
              undefined,
              { buttonText: "Go to Dashboard", buttonUrl: "http://127.0.0.1:3000/dashboard" }
            ).catch((e) => console.error("[Webhook Activation Email Error]", e));
          }
        }

        console.log(`Plan set to ${planName} for user ${userId}${expirationDate ? ` (expires: ${expirationDate.toISOString()})` : ""} via ${eventType}`);
      } else {
        console.error(`Missing userId or planName in webhook metadata for ${eventType}`);
      }

      return NextResponse.json({ success: true });
    }

    // --- Revocation / failure events ---
    if (
      eventType === "SUBSCRIPTION_CANCELLED" ||
      eventType === "PAYMENT_REFUNDED" ||
      eventType === "PAYMENT_DISPUTED"
    ) {
      // Refunds against a steam account order → mark refunded and stop.
      if (
        (eventType === "PAYMENT_REFUNDED" || eventType === "PAYMENT_DISPUTED") &&
        orderId
      ) {
        const shopOrder = await prisma.steamAccountOrder.findUnique({
          where: { pandabaseOrderId: orderId },
        });
        if (shopOrder) {
          await prisma.steamAccountOrder.update({
            where: { id: shopOrder.id },
            data: { status: "REFUNDED" },
          });
          console.log(`[Pandabase Webhook] Steam account order ${shopOrder.id} refunded`);
          return NextResponse.json({ success: true });
        }
      }

      if (purchaseType === "steam_account") {
        console.log(`[Pandabase Webhook] Ignoring ${eventType} for steam account purchase`);
        return NextResponse.json({ success: true });
      }

      if (userId) {
        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (user && user.plan !== "FREE") {
          await prisma.user.update({
            where: { id: userId },
            data: {
              plan: "FREE",
              planExpiry: null,
              planIsCanceled: false,
            },
          });

          const { suspendHostedBotInstance } = await import("@/app/lib/hosted-bot");
          await suspendHostedBotInstance(userId, true).catch((e) =>
            console.error("[Pandabase Webhook] Hosted bot suspend failed:", e)
          );

          const { sendBotDM } = await import("@/app/lib/bot-admin");
          const { sendBrandedEmail } = await import("@/app/lib/email");

          const isFraud = eventType === "PAYMENT_REFUNDED" || eventType === "PAYMENT_DISPUTED";

          // Refunds/chargebacks are treated as fraud — auto-ban and disable all API keys
          if (isFraud) {
            await prisma.user.update({
              where: { id: userId },
              data: { isBanned: true },
            });
            await prisma.apiKey.updateMany({
              where: { userId },
              data: { enabled: false, adminDisable: true },
            });
            try {
              const { refreshBlacklist } = await import("@/app/lib/ratelimit");
              await refreshBlacklist();
            } catch (_) {}
            console.log(`[Pandabase] Auto-banned user ${userId} for ${eventType}`);
          }

          const dmTitle = isFraud ? "Account Suspended — Refund Detected" : "Subscription Cancelled";
          const dmDesc = isFraud
            ? "A refund or chargeback was issued on your subscription. Your account has been suspended and API access disabled. If this was an error, contact support."
            : "Your subscription has been cancelled and your account has been moved to the free plan.";
          const dmColor = isFraud ? 0xef4444 : 0xf97316;

          if (user.discordId) {
            await sendBotDM(user.discordId, "", {
              title: dmTitle,
              description: dmDesc,
              color: dmColor,
              footer: { text: "OpenSteam" },
            }).catch((e) => console.error("[Webhook DM Error]", e));
          }

          if (user.email) {
            const emailBody = isFraud
              ? `A refund or chargeback was detected on your OpenSteam subscription. Your account has been suspended and all API access has been disabled.<br><br>If this was processed in error, please contact our support team to appeal.`
              : `Your subscription has been cancelled and your account has been moved to the free plan. Premium features are no longer active.<br><br>You can resubscribe at any time.`;
            const emailColor = isFraud ? "#ef4444" : "#f97316";

            await sendBrandedEmail(
              user.email,
              `OpenSteam — ${dmTitle}`,
              dmTitle,
              emailBody,
              emailColor,
              undefined,
              { buttonText: "Contact Support", buttonUrl: "http://127.0.0.1:3000/support" }
            ).catch((e) => console.error("[Webhook Deactivation Email Error]", e));
          }

          console.log(`Reverted user ${userId} to FREE plan: ${eventType}`);
        } else {
          console.log(`User ${userId} is already FREE, skipped downgrade for ${eventType}`);
        }
      } else {
        console.log(`Received ${eventType} but no userId found in metadata.`);
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Webhook processing error:", err);
    return NextResponse.json({ success: false }, { status: 200 });
  }
}
