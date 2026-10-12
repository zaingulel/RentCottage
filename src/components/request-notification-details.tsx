import { formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";
import type { RequestNotificationPresentation } from "@/notification/request-notification-status";
import { requestNoticeTitles } from "@/notification/booking-request-notice";
import { NotificationRetryControl } from "./notification-retry-control";
const messages = {
  en: {
    title: "Notifications about this request",
    unavailable:
      "Notification delivery status is unavailable. Your request details remain available.",
    pending: "Waiting to be sent",
    processing: "Being sent",
    retryable: "Delivery failed",
    uncertain: "Delivery outcome uncertain; checking",
    delivered: "Delivered",
    suppressed: "Not sent because it no longer applies",
    retry: "Retry notification",
    failed: "Notification retry failed",
    queued: "Notification queued",
  },
  ar: {
    title: "إشعارات هذا الطلب",
    unavailable: "حالة تسليم الإشعارات غير متاحة. تبقى تفاصيل طلبك متاحة.",
    pending: "في انتظار الإرسال",
    processing: "جارٍ الإرسال",
    retryable: "فشل التسليم",
    uncertain: "نتيجة التسليم غير مؤكدة؛ جارٍ التحقق",
    delivered: "تم التسليم",
    suppressed: "لم يُرسَل لأن الإشعار لم يعد ينطبق",
    retry: "إعادة محاولة الإشعار",
    failed: "فشلت إعادة محاولة الإشعار",
    queued: "تمت إضافة الإشعار إلى قائمة الانتظار",
  },
  ckb: {
    title: "ئاگادارکردنەوەکانی ئەم داواکارییە",
    unavailable:
      "دۆخی گەیاندنی ئاگادارکردنەوە بەردەست نییە. وردەکاری داواکارییەکەت هەر بەردەستە.",
    pending: "چاوەڕێی ناردنە",
    processing: "لە ناردندایە",
    retryable: "گەیاندن سەرکەوتوو نەبوو",
    uncertain: "ئەنجامی گەیاندن نادیارە؛ پشکنین دەکرێت",
    delivered: "گەیەنرا",
    suppressed: "نەنێردرا چونکە ئاگادارکردنەوەکە چیتر پەیوەندیداری نییە",
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
  if (delivery.status === "available" && delivery.notices.length === 0)
    return null;
  const copy = messages[locale];
  return (
    <section className="request-follow-up" aria-label={copy.title}>
      <h2 className="section-title">{copy.title}</h2>
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
