import type {
  NotificationDeliveryAdapter,
  NotificationExecuteResult,
  NotificationLease,
  NotificationQueryResult,
} from "./notification-delivery";
import { fictionalSupplierEnvironment } from "@/booking-request/booking-request-test-runtime-core";

export interface FictionalNotificationEffectRepository {
  queryEffect(lease: NotificationLease): Promise<NotificationQueryResult>;
  executeEffect(lease: NotificationLease): Promise<NotificationExecuteResult>;
}

export class FictionalNotificationAdapter implements NotificationDeliveryAdapter {
  readonly #effects: FictionalNotificationEffectRepository;

  constructor(
    effects: FictionalNotificationEffectRepository,
    environment: Parameters<
      typeof fictionalSupplierEnvironment
    >[0] = process.env,
  ) {
    if (!fictionalSupplierEnvironment(environment))
      throw new Error(
        "Fictional notifications require an approved fictional runtime",
      );
    this.#effects = effects;
  }

  query(lease: NotificationLease) {
    return this.#effects.queryEffect(lease);
  }

  execute(lease: NotificationLease) {
    return this.#effects.executeEffect(lease);
  }
}
