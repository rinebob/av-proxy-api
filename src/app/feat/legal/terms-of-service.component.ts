import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-terms-of-service',
  standalone: true,
  imports: [CommonModule],
  template: `
    <main class="legal-doc">
      <h1>Terms of Service — Savant API</h1>
      <p><em>Last updated: October 31, 2026</em></p>

      <h2>Service description</h2>
      <p>
        Savant API is a personal market-data aggregation and
        pipeline-monitoring service. It caches financial data from licensed
        third-party APIs into a private database, exposes it to authorized
        clients, and sends automated operational SMS alerts about data
        pipeline status to the service operator.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Dashboard access is limited to authenticated, authorized users.</li>
        <li>
          The service and its data may not be resold, redistributed, or used
          for automated trading without the operator's written consent.
        </li>
        <li>
          Users must not attempt to bypass authentication, probe private
          endpoints, or disrupt the service.
        </li>
      </ul>

      <h2>SMS alerts</h2>
      <ul>
        <li>
          SMS messages are operational notifications only (pipeline run
          signoffs and failure alerts), sent to phone numbers configured by
          the operator.
        </li>
        <li>Message and data rates may apply; frequency varies (~4–10 per
          trading day).</li>
        <li>Reply <strong>STOP</strong> to opt out; reply <strong>HELP</strong> for help.</li>
      </ul>

      <h2>Data accuracy disclaimer</h2>
      <p>
        Market data is sourced from third-party providers and cached on a
        TTL basis. It is provided for informational purposes only, may be
        delayed or contain errors, and does not constitute financial advice.
      </p>

      <h2>No warranty; limitation of liability</h2>
      <p>
        The service is provided "as is" without warranties of any kind.
        The operator is not liable for losses arising from use of the
        service or its data, including missed alerts, delayed data, or
        service interruptions.
      </p>

      <h2>Changes and termination</h2>
      <p>
        These terms may be updated at any time. Access may be revoked for
        misuse. The "Last updated" date reflects the current version.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: the service operator via
        <a href="https://github.com/rinebob/av-proxy-api">github.com/rinebob/av-proxy-api</a>.
      </p>
    </main>
  `,
  styles: [`
    .legal-doc {
      max-width: 760px;
      margin: 0 auto;
      padding: 32px 24px 64px;
      font-family: Roboto, sans-serif;
      line-height: 1.6;
      color: #222;
    }
    .legal-doc h1 { font-size: 1.6rem; }
    .legal-doc h2 { font-size: 1.15rem; margin-top: 1.5em; }
    .legal-doc li { margin-bottom: 0.4em; }
  `]
})
export class TermsOfServiceComponent {}
