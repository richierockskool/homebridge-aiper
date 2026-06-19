import type { Logging } from 'homebridge';
import { AiperCrypto } from './aiperCrypto.js';

export type AiperMode = 'Smart' | 'Floor' | 'Wall';

export interface AiperClientConfig {
  email?: string;
  password?: string;
  deviceId?: string;
}

export class AiperClient {

  private readonly crypto = new AiperCrypto();

  private token?: string;
  private userId?: string;
  private baseUrl = 'https://apiamerica.aiper.com';
  private identityId?: string;
  private identityPoolId?: string;
  private openIdToken?: string;
  private iotEndpoint?: string;
  private awsRegion?: string;

  constructor(
    private readonly config: AiperClientConfig,
    private readonly log: Logging,
  ) {}
  async login(): Promise<void> {
    if (!this.config.email || !this.config.password) {
      this.log.warn('Aiper login skipped: email/password not configured.');
      return;
    }

    const loginBody = {
      email: this.config.email,
      password: this.config.password,
    };

    const headers = {
      'Content-Type': 'application/json',
      version: '3.0.0',
      os: 'android',
      charset: 'UTF-8',
      'Accept-Language': 'en',
      zoneId: 'America/Toronto',
      token: '',
      encryptKey: this.crypto.encryptKeyHeader,
    };

    const response = await fetch(`${this.baseUrl}/login`, {
      method: 'POST',
      headers,
      body: this.crypto.encryptRequest(loginBody),
    });

    const text = await response.text();
    const decrypted = this.crypto.decryptResponse(text);
    const payload = JSON.parse(decrypted);

    if (!(payload.code === 0 || payload.code === '0' || payload.successful === true)) {
      throw new Error(`Aiper login failed: ${payload.msg ?? payload.message ?? 'Unknown error'}`);
    }

    const data = payload.data ?? {};

    this.token = data.token;
    this.userId = data.serialNumber;

    if (Array.isArray(data.domain) && data.domain.length > 0) {
      this.baseUrl = String(data.domain[0]).replace(/\/$/, '');
    }

    if (!this.token) {
      throw new Error('Aiper login failed: no token returned.');
    }

    this.log.info('Aiper login successful.');
  }
  async getDevices(): Promise<void> {
    if (!this.token) {
      this.log.warn('Aiper getDevices skipped: not logged in.');
      return;
    }
  
    const headers = {
      'Content-Type': 'application/json',
      version: '3.0.0',
      os: 'android',
      charset: 'UTF-8',
      'Accept-Language': 'en',
      zoneId: 'America/Toronto',
      token: this.token,
      encryptKey: this.crypto.encryptKeyHeader,
    };

    const response = await fetch(`${this.baseUrl}/equipment/getEquipment`, {
      method: 'POST',
      headers,
      body: this.crypto.encryptRequest({}),
    });

    const text = await response.text();
    const decrypted = this.crypto.decryptResponse(text);
    const payload = JSON.parse(decrypted);

    if (!(payload.code === 0 || payload.code === '0' || payload.successful === true)) {
      throw new Error(`Aiper getDevices failed: ${payload.msg ?? payload.message ?? 'Unknown error'}`);
    }

    const devices = Array.isArray(payload.data)
      ? payload.data
      : payload.data?.list ?? payload.data?.equipments ?? [];

    this.log.info(`Aiper devices found: ${devices.length}`);

    for (const device of devices) {
      this.log.info(
        `Aiper device: name=${device.name ?? 'Unknown'} sn=${device.sn ?? 'Unknown'} model=${device.model ?? 'Unknown'}`,
      );
    }
  }

  async getOpenIdToken(): Promise<void> {
    if (!this.token) {
      throw new Error('Aiper OpenID skipped: no token.');
    }

    const headers = {
      'Content-Type': 'application/json',
      version: '3.0.0',
      os: 'android',
      charset: 'UTF-8',
      'Accept-Language': 'en',
      zoneId: 'America/Toronto',
      token: this.token,
      encryptKey: this.crypto.encryptKeyHeader,
    };

    const response = await fetch(`${this.baseUrl}/users/getOpenIdToken`, {
      method: 'POST',
      headers,
      body: this.crypto.encryptRequest({}),
    });

    const text = await response.text();
    const decrypted = this.crypto.decryptResponse(text);
    const payload = JSON.parse(decrypted);

    if (!(payload.code === 0 || payload.code === '0' || payload.successful === true)) {
      throw new Error(`Aiper OpenID failed: ${payload.msg ?? payload.message ?? 'Unknown error'}`);
    }

    const data = payload.data ?? {};

    this.identityId = data.identityId;
    this.identityPoolId = data.identityPoolId;
    this.openIdToken = data.token;
    this.iotEndpoint = data.iotEndpoint;
    this.awsRegion = data.region;

    this.log.info(`Aiper OpenID OK. IoT endpoint: ${this.iotEndpoint ?? 'missing'}`);
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