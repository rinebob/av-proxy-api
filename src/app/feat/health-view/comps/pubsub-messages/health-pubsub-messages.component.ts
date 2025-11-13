import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Firestore, collection, collectionData, query, orderBy, limit, Timestamp, DocumentData } from '@angular/fire/firestore';

interface DataReadyPayloadV1 {
  version: 'v1';
  runId: string;
  phase: 'pre' | 'post';
  intervals: string[];
  time: number;
  baselinesUpdatedCount?: number;
  symbolsUpdatedCount?: number;
  universeVersion?: string;
  marketDate?: string;
  tz?: string;
  durationMs?: number;
  phaseWindow?: { start: number; end: number };
  datasetManifest?: string;
  env?: string;
  traceId?: string;
  trigger?: 'manual' | 'scheduled' | 'heartbeat';
  status?: 'begin' | 'end';
  nextFetchAt?: string;
}

interface RunDoc {
  id: string;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
  enqueuedAt?: Date;
  pubsubMessageId?: string;
  counts?: { baselinesUpdatedCount: number; symbolsUpdatedCount: number };
  pubsubAttributes?: Record<string, string>;
  marketDate?: string;
  intervals?: string[];
  phase?: 'pre' | 'post';
  payload?: DataReadyPayloadV1;
}

@Component({
  selector: 'app-health-pubsub-messages',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './health-pubsub-messages.component.html',
  styleUrls: ['./health-pubsub-messages.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthPubsubMessagesComponent {
  private readonly afs = inject(Firestore);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly rows = signal<RunDoc[]>([]);

  // Define a stable column set derived from payload properties
  readonly displayedColumns = [
    'runId',
    'phase',
    'intervals',
    'time',
    'baselinesUpdatedCount',
    'symbolsUpdatedCount',
    'marketDate',
    'phaseWindow',
    'traceId',
    'trigger',
    'status',
    'nextFetchAt',
  ];

  constructor() {
    const runsCol = collection(this.afs, 'runs');
    const q = query(runsCol, orderBy('updatedAt', 'desc'), limit(200));

    collectionData(q, { idField: 'id' }).subscribe({
      next: (docs: DocumentData[]) => {
        const mapped = (docs || []).map((d: any) => {
          const toDate = (v: any): Date | undefined => {
            if (!v) return undefined;
            try { return v instanceof Timestamp ? v.toDate() : (v.toDate?.() ?? new Date(v)); } catch { return undefined; }
          };
          const payload: DataReadyPayloadV1 | undefined = d.payload as any;
          const counts = d.counts || {};
          const row: RunDoc = {
            id: d.id,
            status: d.status,
            createdAt: toDate(d.createdAt),
            updatedAt: toDate(d.updatedAt),
            enqueuedAt: toDate(d.enqueuedAt),
            pubsubMessageId: d.pubsubMessageId,
            pubsubAttributes: d.pubsubAttributes || {},
            counts: {
              baselinesUpdatedCount: typeof counts.baselinesUpdatedCount === 'number' ? counts.baselinesUpdatedCount : 0,
              symbolsUpdatedCount: typeof counts.symbolsUpdatedCount === 'number' ? counts.symbolsUpdatedCount : 0,
            },
            marketDate: typeof d.marketDate === 'string' ? d.marketDate : undefined,
            intervals: Array.isArray(d.intervals) ? d.intervals : undefined,
            phase: d.phase === 'pre' || d.phase === 'post' ? d.phase : undefined,
            payload,
          };
          return row;
        });
        this.rows.set(mapped);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.message || 'Failed to load Pub/Sub messages');
        this.loading.set(false);
      },
    });
  }

  asArray(v?: any[]): any[] { return Array.isArray(v) ? v : []; }
}
