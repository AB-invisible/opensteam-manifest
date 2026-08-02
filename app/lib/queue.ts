import { prisma } from './prisma';
import { fetchManifestFromMorrenus } from './morrenus';
import { sendWebhook } from './webhooks';
import { turbineCache } from './cache';

/**
 * Turbine Extraction Queue
 * Handles background manifest generation to prevent API timeouts.
 */
class TurbineQueue {
  private static instance: TurbineQueue;
  private isProcessing: boolean = false;
  private maxConcurrency: number = 2; // Default extraction nodes allowed
  private activeJobs: number = 0;

  private constructor() {
    // Start the worker loop
    setInterval(() => this.processQueue(), 15000); // Check every 15s
  }

  public static getInstance(): TurbineQueue {
    if (!TurbineQueue.instance) {
      TurbineQueue.instance = new TurbineQueue();
    }
    return TurbineQueue.instance;
  }

  /**
   * Main worker loop
   */
  public async processQueue() {
    if (this.isProcessing || this.activeJobs >= this.maxConcurrency) return;
    
    this.isProcessing = true;
    
    try {
      // Find the oldest pending request from a gold/premium member first
      let nextRequest = await prisma.gameRequest.findFirst({
        where: {
          status: 'PENDING',
          user: {
            plan: {
              in: ['PREMIUM', 'RESELLER', 'BUSINESS', 'CUSTOM']
            }
          }
        },
        orderBy: { createdAt: 'asc' },
        include: { user: true }
      });

      // If no priority request, fall back to the oldest pending request overall
      if (!nextRequest) {
        nextRequest = await prisma.gameRequest.findFirst({
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'asc' },
          include: { user: true }
        });
      }

      if (!nextRequest) {
        this.isProcessing = false;
        return;
      }

      // Mark as IN_PROGRESS
      await prisma.gameRequest.update({
        where: { id: nextRequest.id },
        data: { status: 'IN_PROGRESS' as any }
      });

      this.activeJobs++;
      
      // Perform extraction (Fire and Forget or await based on logic)
      this.executeExtraction(nextRequest);

      // Webhook: Worker start
      sendWebhook('WORKER_START', {
        userId: nextRequest.userId,
        username: nextRequest.user.username,
        gameName: nextRequest.name,
        appId: nextRequest.appId
      });

    } catch (error) {
      console.error('TurbineQueue Worker Error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Actual extraction logic
   */
  private async executeExtraction(request: any) {
    console.log(`[TurbineQueue] Processing extraction for ${request.name} (${request.appId})`);
    
    try {
      const result = await fetchManifestFromMorrenus(request.appId);
      
      if (result.success) {
        // Create the manifest record
        const manifest = await prisma.manifest.upsert({
          where: { steamAppId: request.appId },
          update: { updatedAt: new Date() },
          create: {
            id: String(request.appId),
            steamAppId: request.appId,
            name: request.name,
            fileSize: result.zipBuffer ? BigInt(result.zipBuffer.length) : BigInt(0),
            userId: request.userId,
            tags: []
          }
        });

        // Populate cache for immediate use
        turbineCache.set(`manifest:${request.appId}`, manifest);

        // Update request status
        await prisma.gameRequest.update({
          where: { id: request.id },
          data: { status: 'DONE' }
        });

        // Webhook: Success
        sendWebhook('WORKER_RESULT', {
          userId: request.userId,
          username: request.user.username,
          gameName: request.name,
          appId: request.appId,
          status: 'SUCCESS'
        });

        console.log(`[TurbineQueue] Successfully generated manifest for ${request.appId}`);
      } else {
        throw new Error(result.error || 'Extraction failed');
      }
    } catch (error: any) {
      console.error(`[TurbineQueue] Job failed for ${request.appId}:`, error.message);
      
      await prisma.gameRequest.update({
        where: { id: request.id },
        data: { 
          status: 'REJECTED',
          reason: `Auto-extraction failed: ${error.message}`
        }
      });
    } finally {
      this.activeJobs--;
      // Immediately check for next job
      this.processQueue();
    }
  }
}

export const turbineQueue = TurbineQueue.getInstance();
