import { Firestore, FieldValue } from "firebase-admin/firestore";

export interface RequestEvent {
  timestamp: FirebaseFirestore.Timestamp;
  status: 'success' | 'failure';
  vendor: string;
  process: string;
  params: Record<string, any>;
  itemCount: number;
  durationMs: number;
  error?: string;
}

export class RequestLoggerService {
  constructor(private db: Firestore) {}

  /**
   * Logs a request event to the specified vendor's document in Firestore.
   *
   * @param {string} vendor The name of the vendor (e.g., 'benzinga', 'alpha-vantage').
   * @param {RequestEvent} event The request event object to log.
   */
  async logRequest(vendor: string, event: Omit<RequestEvent, 'vendor'>): Promise<void> {
    const docRef = this.db.collection('news').doc(vendor);
    const fullEvent: RequestEvent = {
      ...event,
      vendor,
    };

    try {
      await docRef.update({
        request_history: FieldValue.arrayUnion(fullEvent),
        last_request: fullEvent,
      });
    } catch (error: any) {
      if (error.code === 5) { // 5 = NOT_FOUND
        // The document doesn't exist, so create it.
        await docRef.set({ 
          request_history: [fullEvent],
          last_request: fullEvent,
        });
      } else {
        // Re-throw other errors
        throw error;
      }
    }
  }
}
