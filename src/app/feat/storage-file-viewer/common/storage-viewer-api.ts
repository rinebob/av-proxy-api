import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from, map } from 'rxjs';

import type {
  StorageViewerRequest,
  ListResult,
  ReadResult,
  ListTimeSeriesRequest,
  ListCorpusRequest,
  ReadTimeSeriesRequest,
  ReadCorpusRequest,
} from '@shared/options';

/** Cloud Function export name matching the backend onCall handler. */
export const STORAGE_FILE_VIEWER_FN = 'storageFileViewer';

/**
 * Service wrapping the `storageFileViewer` Firebase Callable Function.
 * Uses httpsCallable for auth-token propagation and RxJS for stream composition.
 */
@Injectable({ providedIn: 'root' })
export class StorageViewerApiService {
  private readonly functions = inject(Functions);

  private readonly callable = httpsCallable<StorageViewerRequest, ListResult | ReadResult>(
    this.functions,
    STORAGE_FILE_VIEWER_FN,
  );

  /** List contracts (time-series) or dates (corpus) for a symbol. */
  list(req: ListTimeSeriesRequest | ListCorpusRequest): Observable<ListResult> {
    return from(this.callable(req)).pipe(
      map(({ data }) => data as ListResult),
    );
  }

  /** Read a single file's content from GCS. */
  read(req: ReadTimeSeriesRequest | ReadCorpusRequest): Observable<ReadResult> {
    return from(this.callable(req)).pipe(
      map(({ data }) => data as ReadResult),
    );
  }
}
