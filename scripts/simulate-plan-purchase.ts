#!/usr/bin/env npx tsx
/**
 * Simulate a Pandabase plan purchase (PAYMENT_COMPLETED webhook flow).
 *
 * Updates the user's plan, upserts hosted-bot access, generates a PDF receipt,
 * and optionally sends the same confirmation email + Discord DM as production.
 *
 * Usage:
 *   npx tsx scripts/simulate-plan-purchase.ts <user> <PLAN> [options]
 *   npm run simulate-purchase -- <user> PREMIUM
 *
 * <user> can be internal user id or Discord snowflake.
 * <PLAN> must be one of: REGULAR, PREMIUM, RESELLER, BUSINESS
 *
 * Options:
 *   --months N      Duration in months (default: 1 for BUSINESS, lifetime for others)
 *   --indefinite    No expiry date
 *   --output path   Save receipt PDF to this file
 *   --no-email      Skip confirmation + receipt emails
 *   --no-dm         Skip Discord DM
 *   --dry-run       Preview actions without writing to the database
 */

import fs from 'fs'
import path from 'path'
import { Plan } from '@prisma/client'

const PURCHASABLE_PLANS: Plan[] = ['REGULAR', 'PREMIUM', 'RESELLER', 'BUSINESS']

type CliOptions = {
  months?: number
  indefinite: boolean
  output?: string
  noEmail: boolean
  noDm: boolean
  dryRun: boolean
}

function loadEnv() {
  const envPath = path.join(__dirname, '../.env')
  if (!fs.existsSync(envPath)) return

  const envContent = fs.readFileSync(envPath, 'utf8')
  for (const line of envContent.split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
    if (!match) continue
    const key = match[1]
    let value = match[2] || ''
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function printUsage() {
  console.log(`
Simulate a Pandabase plan purchase and generate an invoice receipt.

Usage:
  npx tsx scripts/simulate-plan-purchase.ts <user> <PLAN> [options]

Arguments:
  user   Internal user id or Discord snowflake
  plan   ${PURCHASABLE_PLANS.join(', ')}

Options:
  --months N      Duration in months (BUSINESS defaults to 1 month)
  --indefinite    No expiry date (lifetime access)
  --output path   Save receipt PDF to disk
  --no-email      Skip confirmation and receipt emails
  --no-dm         Skip Discord DM notification
  --dry-run       Preview without applying database changes
  --help          Show this help

Examples:
  npx tsx scripts/simulate-plan-purchase.ts clxyz123 PREMIUM --output ./receipt.pdf
  npx tsx scripts/simulate-plan-purchase.ts 123456789012345678 BUSINESS --months 1
  npm run simulate-purchase -- clxyz123 RESELLER --no-email
`)
}

function parseArgs(argv: string[]) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage()
    process.exit(0)
  }

  const positionals: string[] = []
  const options: CliOptions = {
    indefinite: false,
    noEmail: false,
    noDm: false,
    dryRun: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--indefinite') {
      options.indefinite = true
      continue
    }
    if (arg === '--no-email') {
      options.noEmail = true
      continue
    }
    if (arg === '--no-dm') {
      options.noDm = true
      continue
    }
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (arg === '--months') {
      const next = argv[++i]
      const months = Number(next)
      if (!Number.isFinite(months) || months < 1) {
        throw new Error('--months requires a positive number')
      }
      options.months = Math.round(months)
      continue
    }
    if (arg === '--output') {
      const next = argv[++i]
      if (!next) throw new Error('--output requires a file path')
      options.output = next
      continue
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    }
    positionals.push(arg)
  }

  if (positionals.length < 2) {
    printUsage()
    process.exit(1)
  }

  const [userRef, planRaw] = positionals
  const plan = planRaw.toUpperCase() as Plan
  if (!PURCHASABLE_PLANS.includes(plan)) {
    throw new Error(`Invalid plan "${planRaw}". Use one of: ${PURCHASABLE_PLANS.join(', ')}`)
  }

  return { userRef, plan, options }
}

function resolveExpirationDate(plan: Plan, options: CliOptions, currentPlan?: Plan, currentExpiry?: Date | null) {
  if (options.indefinite) return null

  const months =
    options.months ??
    (plan === 'BUSINESS' ? 1 : null)

  if (months === null) return null

  let base = new Date()
  if (currentPlan === plan && currentExpiry && currentExpiry > base) {
    base = new Date(currentExpiry)
  }

  const expiry = new Date(base)
  expiry.setMonth(expiry.getMonth() + months)
  return expiry
}

async function main() {
  loadEnv()

  const { userRef, plan, options } = parseArgs(process.argv.slice(2))
  const { findUserByIdentifier } = await import('../app/lib/admin-plan-upgrade')
  const { prisma } = await import('../app/lib/prisma')

  const user = await findUserByIdentifier(userRef)
  if (!user) {
    console.error(`User not found: ${userRef}`)
    process.exit(1)
  }

  const expirationDate = resolveExpirationDate(plan, options, user.plan, user.planExpiry)
  const expiryStr = expirationDate
    ? expirationDate.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  console.log('--- Simulate plan purchase ---')
  console.log(`User:       ${user.username} (${user.id})`)
  console.log(`Discord:    ${user.discordId}`)
  console.log(`Plan:       ${user.plan} -> ${plan}`)
  console.log(`Expiry:     ${expirationDate ? expirationDate.toISOString() : 'none (lifetime)'}`)
  console.log(`Dry run:    ${options.dryRun ? 'yes' : 'no'}`)
  console.log(`Send email: ${options.noEmail ? 'no' : 'yes'}`)
  console.log(`Send DM:    ${options.noDm ? 'no' : 'yes'}`)
  if (options.output) console.log(`PDF output: ${options.output}`)
  console.log('------------------------------')

  if (options.dryRun) {
    console.log('Dry run complete — no changes applied.')
    return
  }

  const fullUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, username: true, email: true, discordId: true },
  })
  if (!fullUser) {
    console.error('User disappeared before update.')
    process.exit(1)
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      plan,
      planExpiry: expirationDate,
      planIsCanceled: false,
    },
  })
  console.log(`Updated plan to ${plan}.`)

  const { upsertHostedBotInstanceForUser } = await import('../app/lib/hosted-bot')
  await upsertHostedBotInstanceForUser(user.id, plan).catch((err) => {
    console.error('[simulate-purchase] Hosted bot upsert failed:', err)
  })

  const { generateReceiptPdf } = await import('../app/lib/receipt')
  const purchaseDate = new Date()
  const pdfBuffer = await generateReceiptPdf(fullUser.username, plan, purchaseDate, expirationDate)

  if (options.output) {
    const outPath = path.resolve(options.output)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, pdfBuffer)
    console.log(`Receipt saved to ${outPath}`)
  }

  if (!options.noDm && fullUser.discordId) {
    const { sendBotDM } = await import('../app/lib/bot-admin')
    await sendBotDM(fullUser.discordId, '', {
      title: 'Payment Confirmed',
      description: `Your **${plan}** plan is now active.${expiryStr ? `\n\n**Valid until:** ${expiryStr}` : ''}\n\nA receipt has been sent to your email address.`,
      color: 0x10b981,
      footer: { text: 'OpenSteam' },
    }).catch((err) => console.error('[simulate-purchase] Discord DM failed:', err))
    console.log('Discord DM sent.')
  }

  if (!options.noEmail && fullUser.email) {
    const { sendEmail, sendBrandedEmail } = await import('../app/lib/email')
    const purchaseDateStr = purchaseDate.toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    const bodyHtml =
      `Your <strong>${plan}</strong> plan is now active.<br><br>` +
      `<strong>Plan:</strong> ${plan}<br>` +
      `<strong>Purchased:</strong> ${purchaseDateStr}<br>` +
      (expiryStr ? `<strong>Valid until:</strong> ${expiryStr}<br>` : '') +
      `<br>Your receipt is attached to this email.`

    await sendBrandedEmail(
      fullUser.email,
      `OpenSteam ${plan} — Payment Confirmed`,
      'Payment Confirmed',
      bodyHtml,
      '#10b981',
      undefined,
      {
        buttonText: 'Go to Dashboard',
        buttonUrl: 'http://127.0.0.1:3000/dashboard',
        badge: 'Payment Received',
      },
    ).catch((err) => console.error('[simulate-purchase] Confirmation email failed:', err))

    await sendEmail(
      fullUser.email,
      `Receipt — OpenSteam ${plan} Plan`,
      `<p style="font-family:sans-serif;color:#94a3b8;font-size:14px;">Hi ${fullUser.username}, your receipt for the ${plan} plan is attached.</p>`,
      [
        {
          filename: `Receipt_${plan.replace(/\s+/g, '_')}_${Date.now()}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
      undefined,
      { userId: fullUser.id },
    ).catch((err) => console.error('[simulate-purchase] Receipt email failed:', err))

    console.log(`Receipt emails sent to ${fullUser.email}.`)
  } else if (!options.noEmail && !fullUser.email) {
    console.log('No email on file — skipped receipt emails.')
  }

  console.log('Purchase simulation complete.')
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
  .finally(async () => {
    const { prisma } = await import('../app/lib/prisma')
    await prisma.$disconnect()
  })
