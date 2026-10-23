import "server-only";
import {
  createPaymentOperations,
  type PaymentOperations,
} from "./payment-operations";

export function createRequestPaymentOperations():
  | PaymentOperations
  | undefined {
  return createPaymentOperations(process.env);
}
