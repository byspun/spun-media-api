import type { SubscriptionRecord } from './types.js';

export interface BillingCustomerInput {
  accountId: string;
  email?: string | null;
  name?: string | null;
}

export interface BillingSubscriptionInput {
  accountId: string;
  planSlug: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface BillingProvider {
  createCustomer(input: BillingCustomerInput): Promise<{ customerId: string }>;
  createSubscription(input: BillingSubscriptionInput): Promise<{ providerSubscriptionId: string; checkoutUrl?: string }>;
  cancelSubscription(providerSubscriptionId: string, immediately?: boolean): Promise<void>;
  verifyWebhook(request: Request): Promise<{ eventId: string; type: string; payload: unknown }>;
  applySubscriptionEvent(event: { type: string; payload: unknown }): Promise<SubscriptionRecord | null>;
}

export class BillingNotEnabledError extends Error {
  constructor() {
    super('Billing integration is not enabled');
    this.name = 'BillingNotEnabledError';
  }
}

/**
 * Safe placeholder until a payment gateway and webhook credentials are supplied.
 * It intentionally fails closed rather than pretending a payment succeeded.
 */
export class DisabledBillingProvider implements BillingProvider {
  async createCustomer(_input: BillingCustomerInput): Promise<{ customerId: string }> {
    throw new BillingNotEnabledError();
  }

  async createSubscription(_input: BillingSubscriptionInput): Promise<{ providerSubscriptionId: string; checkoutUrl?: string }> {
    throw new BillingNotEnabledError();
  }

  async cancelSubscription(_providerSubscriptionId: string, _immediately = false): Promise<void> {
    throw new BillingNotEnabledError();
  }

  async verifyWebhook(_request: Request): Promise<{ eventId: string; type: string; payload: unknown }> {
    throw new BillingNotEnabledError();
  }

  async applySubscriptionEvent(_event: { type: string; payload: unknown }): Promise<SubscriptionRecord | null> {
    throw new BillingNotEnabledError();
  }
}
