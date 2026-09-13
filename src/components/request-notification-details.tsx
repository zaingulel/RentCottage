import { formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";
import type { RequestNotificationPresentation } from "@/notification/request-notification-status";
import { requestNoticeTitles } from "@/notification/booking-request-notice";
import { NotificationRetryControl } from "./notification-retry-control";
const messages = {
  en: {
    title: "Request notification delivery",
    unavailable:
      "Notification delivery status is unavailable. Your request details remain available.",
    pending: "Queued",
    processing: "Delivery processing",
    retryable: "Delivery failed; retry available",
    uncertain: "Delivery outcome uncertain; checking",
    delivered: "Delivered",
    suppressed: "Delivery withheld because this notice is no longer eligible",
    retry: "Retry notification",
    failed: "Notification retry failed",
    queued: "Notification queued",
  },
  ar: {
    title: "تسليم إشعارات الطلب",
    unavailable: "حالة تسليم الإشعارات غير متاحة. تبقى تفاصيل طلبك متاحة.",
    pending: "في قائمة الانتظار",
    processing: "جارٍ التسليم",
    retryable: "فشل التسليم؛ يمكن إعادة المحاولة",
    uncertain: "نتيجة التسليم غير مؤكدة؛ جارٍ التحقق",
    delivered: "تم التسليم",
    suppressed: "تم حجب التسليم لأن الإشعار لم يعد مؤهلاً",
    retry: "إعادة محاولة الإشعار",
    failed: "فشلت إعادة محاولة الإشعار",
    queued: "تمت إضافة الإشعار إلى قائمة الانتظار",
  },
  ckb: {
    title: "گەیاندنی ئاگادارکردنەوەی داواکاری",
    unavailable:
      "دۆخی گەیاندنی ئاگادارکردنەوە بەردەست نییە. وردەکاری داواکارییەکەت هەر بەردەستە.",
    pending: "لە ڕیزدایە",
    processing: "گەیاندن لە پرۆسەدایە",
    retryable: "گەیاندن سەرکەوتوو نەبوو؛ دووبارە هەوڵ بدە",
    uncertain: "ئەنجامی گەیاندن نادیارە؛ پشکنین دەکرێت",
    delivered: "گەیەندرا",
    suppressed: "گەیاندن ڕاگیرا چونکە ئاگادارکردنەوەکە چیتر شیاو نییە",
    retry: "دووبارە هەوڵی ئاگادارکردنەوە",
    failed: "دووبارە هەوڵدان سەرکەوتوو نەبوو",
    queued: "ئاگادارکردنەوەکە خرایە ڕیزەوە",
  },
};
export function RequestNotificationDetails({
  locale,
  reference,
  delivery,
}: {
  readonly locale: Locale;
  readonly reference: string;
  readonly delivery: RequestNotificationPresentation;
}) {
  const copy = messages[locale];
  return (
    <section aria-label={copy.title}>
      <h2>{copy.title}</h2>
      {delivery.status === "unavailable" ? (
        <p role="status">{copy.unavailable}</p>
      ) : (
        <ul>
          {delivery.notices.map((notice) => (
            <li key={notice.eventId}>
              <p>
                {requestNoticeTitles[locale][notice.kind]} —{" "}
                <time dateTime={notice.createdAt}>
                  {formatIraqDateTime(notice.createdAt, locale)}
                </time>
              </p>
              <p>{copy[notice.state]}</p>
              {notice.retryAllowed ? (
                <NotificationRetryControl
                  locale={locale}
                  reference={reference}
                  receiptId={null}
                  eventId={notice.eventId}
                  label={copy.retry}
                  failed={copy.failed}
                  queued={copy.queued}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
