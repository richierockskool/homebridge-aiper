import type { Logging } from 'homebridge';

export type AiperMode = 'Smart' | 'Floor' | 'Wall';

export interface AiperClientConfig {
  email?: string;
  password?: string;
  deviceId?: string;
}

export class AiperClient {
  constructor(
  private readonly config: AiperClientConfig,
  private readonly log: Logging,
  ) {}

  async login(): Promise<void> {
    if (!this.config.email || !this.config.password) {
      this.log.warn('Aiper login skipped: email/password not configured.');
      return;
    }

    this.log.info('Aiper login placeholder ready for:', this.config.email);

    // Later:
    // 1. Call Aiper cloud login
    // 2. Store access token
    // 3. Refresh token when needed
  }

  async getStatus(): Promise<void> {
    this.log.info('Aiper status placeholder called.');

    // Later:
    // Return battery, charging, current mode, online/offline, etc.
  }

  async startMode(mode: AiperMode): Promise<void> {
    this.log.info(`Aiper command placeholder: start ${mode}`);

    // Later:
    // Smart -> send smart-clean command
    // Floor -> send floor-clean command
    // Wall  -> send wall-clean command
  }

  async stop(): Promise<void> {
    this.log.info('Aiper command placeholder: stop');

    // Later:
    // Send stop / pause / dock command
  }
}