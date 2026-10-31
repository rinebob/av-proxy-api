import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  imports: [CommonModule],
  template: `
    <main class="legal-doc">
      <h1>Privacy Policy — Savant API</h1>
      <p><em>Last updated: October 31, 2026</em></p>

      <h2>Overview</h2>
      <p>
        Savant API is a personal market-data and pipeline-operations service
        operated by a single developer. It provides a small web dashboard to
        authorized users and sends automated operational SMS alerts to the
        service operator's own phone number. It is not a public commercial
        service and does not offer accounts to the general public.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account data:</strong> sign-in credentials for authorized
          dashboard users (managed by Firebase Authentication — email/Google
          sign-in only).
        </li>
        <li>
          <strong>Operator phone number:</strong> a single phone number used
          solely to receive automated pipeline status SMS alerts sent by the
          service itself.
        </li>
        <li>
          <strong>Market data:</strong> publicly available financial data
          cached from third-party APIs. No personal user portfolios or
          private financial information are collected.
        </li>
      </ul>

      <h2>SMS program specifics</h2>
      <ul>
        <li>
          SMS messages are <strong>transactional operational alerts only</strong>
          (pipeline completion signoffs and failure exceptions). No marketing
          or promotional messages are ever sent.
        </li>
        <li>Message frequency: approximately 4–10 messages per trading day.</li>
        <li>Message and data rates may apply.</li>
        <li>
          Recipients may opt out at any time by replying <strong>STOP</strong>,
          and may request help by replying <strong>HELP</strong>.
        </li>
        <li>
          Phone numbers used for SMS delivery are not shared with, sold to,
          or disclosed to third parties for their marketing purposes.
        </li>
      </ul>

      <h2>Data sharing and retention</h2>
      <p>
        We do not sell, rent, or share personal information with third parties
        except as required to operate the service (Google Cloud/Firebase
        hosting, Firebase Authentication, and Twilio for SMS delivery). Data
        is retained in Google Cloud Firestore under the project's configured
        TTL policies and can be deleted on request.
      </p>

      <h2>Security</h2>
      <p>
        Access to the dashboard requires authentication. API keys, secrets,
        and credentials are stored in Google Cloud Secret Manager and are
        never exposed to clients.
      </p>

      <h2>Changes</h2>
      <p>
        This policy may be updated as the service evolves. The "Last updated"
        date above reflects the current version.
      </p>

      <h2>Contact</h2>
      <p>
        For privacy questions or data-deletion requests, contact the service
        operator via the repository at
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
export class PrivacyPolicyComponent {}
