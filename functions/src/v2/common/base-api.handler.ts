import { Request, Response } from 'express';
import * as admin from 'firebase-admin';
import { VendorType } from './refresh.types';

export abstract class BaseApiHandler<T = any> {
  protected vendor: VendorType;
  protected endpoint: string;
  protected db: admin.firestore.Firestore;

  constructor(vendor: VendorType, endpoint: string) {
    this.vendor = vendor;
    this.endpoint = endpoint;
    this.db = admin.firestore();
  }

  /**
   * Main handler method to be implemented by subclasses
   */
  public abstract handleRequest(req: Request, res: Response): Promise<void>;

  /**
   * Sends a standardized error response
   */
  protected sendErrorResponse(
    res: Response, 
    status: number, 
    message: string,
    error?: any
  ): void {
    console.error(`[${this.vendor.toUpperCase()}:${this.endpoint}] Error:`, message, error);
    
    res.status(status).json({
      success: false,
      error: message,
      timestamp: admin.firestore.Timestamp.now().toDate().toISOString()
    });
  }

  /**
   * Sends a standardized success response
   */
  protected sendSuccessResponse(
    res: Response,
    data: any,
    fromCache: boolean,
    ttlSeconds?: number
  ): void {
    res.status(200).json({
      success: true,
      data,
      metadata: {
        fromCache,
        timestamp: admin.firestore.Timestamp.now().toDate().toISOString(),
        ...(ttlSeconds && {
          ttlSeconds,
          nextRefreshAt: new Date(Date.now() + ttlSeconds * 1000).toISOString()
        })
      }
    });
  }
}
