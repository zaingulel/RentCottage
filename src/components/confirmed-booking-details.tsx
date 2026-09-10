import Link from "next/link";
import type { ConfirmedBookingAccess } from "@/booking-request/confirmed-booking-access";
import type { PaidConfirmationNotificationPresentationStatus } from "@/booking-request/request-confirmed-booking-access";
import { formatFilsAsIqd, formatIqd, formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";
import { NotificationRetryControl } from "./notification-retry-control";

const messages = {
  en: {
    title: "Confirmed booking",
    reference: "Booking reference",
    customer: "Customer",
    period: "Booking period",
    party: "Party size",
    price: "Booking price",
    fee: "Service fee",
    total: "Customer total",
    commission: "Marketplace commission",
    net: "Cottage Owner net",
    rules: "House Rules",
    terms: "Booking terms",
    address: "Exact address",
    directions: "Private directions",
    map: "Map pin",
    customerPhone: "Customer phone",
    ownerPhone: "Cottage Owner phone",
    notice: "Confirmation notice",
    fictional:
      "Local fictional delivery only — no message was sent by a real supplier.",
    retry: "Retry confirmation notice",
    retryFailed:
      "The notice could not be retried. Your booking details are still available.",
    retryQueued: "Confirmation notice queued for retry.",
    history: "Booking History",
    delivered: "Delivered",
    historical: "Delivered before access was withdrawn",
    pending: "Pending",
    processing: "Processing",
    retryable: "Delivery failed",
    uncertain: "Checking delivery",
    suppressed: "Suppressed",
    unavailable: "Delivery status is temporarily unavailable",
    incomplete: "Some practical access or contact details are unavailable.",
  },
  ar: {
    title: "حجز مؤكد",
    reference: "مرجع الحجز",
    customer: "العميل",
    period: "فترة الحجز",
    party: "عدد أفراد المجموعة",
    price: "سعر الحجز",
    fee: "رسوم الخدمة",
    total: "إجمالي العميل",
    commission: "عمولة المنصة",
    net: "صافي مالك البيت",
    rules: "قواعد البيت",
    terms: "شروط الحجز",
    address: "العنوان الدقيق",
    directions: "إرشادات الوصول الخاصة",
    map: "إحداثيات الخريطة",
    customerPhone: "هاتف العميل",
    ownerPhone: "هاتف مالك البيت",
    notice: "إشعار التأكيد",
    fictional: "توصيل تجريبي محلي فقط — لم يرسل مورد حقيقي أي رسالة.",
    retry: "إعادة محاولة إشعار التأكيد",
    retryFailed: "تعذرت إعادة محاولة الإشعار. لا تزال تفاصيل حجزك متاحة.",
    retryQueued: "تم وضع إشعار التأكيد في قائمة إعادة المحاولة.",
    history: "سجل الحجوزات",
    delivered: "تم التسليم",
    historical: "تم التسليم قبل سحب الوصول",
    pending: "قيد الانتظار",
    processing: "قيد المعالجة",
    retryable: "فشل التسليم",
    uncertain: "جارٍ التحقق من التسليم",
    suppressed: "تم الإيقاف",
    unavailable: "حالة التسليم غير متاحة مؤقتاً",
    incomplete: "بعض تفاصيل الوصول أو الاتصال غير متاحة.",
  },
  ckb: {
    title: "حجزی پشتڕاستکراو",
    reference: "ژمارەی حجز",
    customer: "کڕیار",
    period: "ماوەی حجز",
    party: "ژمارەی کەسان",
    price: "نرخی حجز",
    fee: "کرێی خزمەتگوزاری",
    total: "کۆی گشتی کڕیار",
    commission: "کۆمسیۆنی بازاڕ",
    net: "پاشماوەی خاوەن کۆتێج",
    rules: "یاساکانی کۆتێج",
    terms: "مەرجەکانی حجز",
    address: "ناونیشانی ورد",
    directions: "ڕێنمایی تایبەتی گەیشتن",
    map: "خاڵی نەخشە",
    customerPhone: "تەلەفۆنی کڕیار",
    ownerPhone: "تەلەفۆنی خاوەن کۆتێج",
    notice: "ئاگادارکردنەوەی پشتڕاستکردن",
    fictional:
      "تەنها گەیاندنی تاقیکردنەوەی ناوخۆییە — هیچ دابینکەرێکی ڕاستەقینە پەیامی نەناردووە.",
    retry: "دووبارە هەوڵدانەوەی ئاگادارکردن",
    retryFailed:
      "دووبارە هەوڵدانەوەی ئاگادارکردنەوەکە سەرکەوتوو نەبوو. وردەکارییەکانی حجزەکەت هەر بەردەستن.",
    retryQueued: "ئاگادارکردنەوەی پشتڕاستکردن بۆ دووبارە هەوڵدانەوە ڕیزکرا.",
    history: "مێژووی حجزەکان",
    delivered: "گەیەنرا",
    historical: "پێش لابردنی دەستگەیشتن گەیەنرا",
    pending: "چاوەڕێ",
    processing: "لە کاردایە",
    retryable: "گەیاندن سەرکەوتوو نەبوو",
    uncertain: "گەیاندن پشکنین دەکرێت",
    suppressed: "وەستێنرا",
    unavailable: "دۆخی گەیاندن کاتێک بەردەست نییە",
    incomplete: "هەندێک وردەکاری گەیشتن یان پەیوەندی بەردەست نییە.",
  },
} as const;

export function ConfirmedBookingDetails({
  locale,
  access,
  notification,
}: {
  locale: Locale;
  access: ConfirmedBookingAccess;
  notification: PaidConfirmationNotificationPresentationStatus;
}) {
  const c = messages[locale];
  const practicalDetailsIncomplete =
    access.exactAddress === null ||
    access.privateDirections === null ||
    access.mapPin === null ||
    access.customerPhone === null ||
    access.ownerPhone === null;
  return (
    <section
      className="confirmed-booking-details"
      aria-labelledby="confirmed-booking-heading"
    >
      <header>
        <div>
          <h1 id="confirmed-booking-heading">{c.title}</h1>
          <p>{access.cottageName}</p>
          <strong>{access.bookingReference}</strong>
        </div>
        <Link href={`/${locale}/bookings`}>{c.history}</Link>
      </header>
      {practicalDetailsIncomplete ? (
        <p role="status" aria-label={c.incomplete}>
          {c.incomplete}
        </p>
      ) : null}
      <dl>
        <div>
          <dt>{c.reference}</dt>
          <dd>{access.bookingReference}</dd>
        </div>
        <div>
          <dt>{c.customer}</dt>
          <dd>{access.customerName}</dd>
        </div>
        <div>
          <dt>{c.period}</dt>
          <dd>
            {access.bookingPeriod.map((item) => (
              <span
                key={`${item.serviceDay}-${item.kind}-${item.position ?? "full"}`}
              >
                {item.displayName} · {formatIraqDateTime(item.startsAt, locale)}{" "}
                – {formatIraqDateTime(item.endsAt, locale)}
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt>{c.party}</dt>
          <dd>{access.partySize}</dd>
        </div>
        <div>
          <dt>{c.price}</dt>
          <dd>{formatIqd(access.pricing.bookingPriceIqd, locale)}</dd>
        </div>
        {access.actorRole === "customer" ? (
          <>
            <div>
              <dt>{c.fee}</dt>
              <dd>{formatIqd(access.pricing.serviceFeeIqd, locale)}</dd>
            </div>
            <div>
              <dt>{c.total}</dt>
              <dd>{formatIqd(access.pricing.customerTotalIqd, locale)}</dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>{c.commission}</dt>
              <dd>
                {formatFilsAsIqd(
                  access.pricing.marketplaceCommissionFils,
                  locale,
                )}
              </dd>
            </div>
            <div>
              <dt>{c.net}</dt>
              <dd>{formatFilsAsIqd(access.pricing.ownerNetFils, locale)}</dd>
            </div>
          </>
        )}
        <div>
          <dt>{c.rules}</dt>
          <dd dir="auto">{access.houseRules}</dd>
        </div>
        <div>
          <dt>{c.terms}</dt>
          <dd dir="auto">{access.bookingTermsBody}</dd>
        </div>
        {access.exactAddress ? (
          <div>
            <dt>{c.address}</dt>
            <dd dir="auto">{access.exactAddress}</dd>
          </div>
        ) : null}
        {access.privateDirections ? (
          <div>
            <dt>{c.directions}</dt>
            <dd dir="auto">{access.privateDirections}</dd>
          </div>
        ) : null}
        {access.mapPin ? (
          <div>
            <dt>{c.map}</dt>
            <dd>
              <bdi dir="ltr">
                {access.mapPin.latitude}, {access.mapPin.longitude}
              </bdi>
            </dd>
          </div>
        ) : null}
        {access.customerPhone ? (
          <div>
            <dt>{c.customerPhone}</dt>
            <dd>
              <bdi dir="ltr">{access.customerPhone}</bdi>
            </dd>
          </div>
        ) : null}
        {access.ownerPhone ? (
          <div>
            <dt>{c.ownerPhone}</dt>
            <dd>
              <bdi dir="ltr">{access.ownerPhone}</bdi>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{c.notice}</dt>
          <dd>
            <span role="status">
              {notification.historical ? c.historical : c[notification.state]}
            </span>
            <small>{c.fictional}</small>
            {notification.state === "retryable" ? (
              <NotificationRetryControl
                locale={locale}
                reference={access.bookingRequestReference}
                receiptId={access.receiptId}
                label={c.retry}
                failed={c.retryFailed}
                queued={c.retryQueued}
              />
            ) : null}
          </dd>
        </div>
      </dl>
    </section>
  );
}
