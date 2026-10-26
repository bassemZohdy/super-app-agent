/** Shell text in English and Arabic, and locale-aware money, dates and times (P2-01). A catalog is a flat map of keys to text; the two
 *  catalogs must have the same keys and the same {placeholders}, which a test enforces. Arabic text is written for right-to-left
 *  layout; numbers keep Latin digits so an amount reads the same on screen, in a receipt and in a statement. */
export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

const en = {
  'app.newConversation': 'New conversation',
  'nav.yourSpace': 'Your space',
  'nav.yourConcierge': 'Your concierge',
  'nav.conversations': 'Conversations',
  'nav.exploreServices': 'Explore services',
  'nav.myProfile': 'My profile',
  'nav.currentAccount': 'Current account',
  'nav.signOut': 'Sign out',
  'nav.open': 'Open navigation',
  'nav.close': 'Close navigation',
  'nav.closeMenu': 'Close navigation menu',
  'service.mobility': 'Mobility',
  'service.utilities': 'Utilities',
  'service.citizenpay': 'Payments',
  'service.telecom': 'Telecom',
  'service.housing': 'Housing',
  'tools.delegatedAccess': 'Delegated access',
  'tools.connections': 'Connections',
  'tools.paymentAccounts': 'Payment accounts',
  'footer.madeForLife': 'Made for life in Dubai',
  'footer.cityServices': 'City services, one conversation.',
  'status.demoMode': 'Demo mode',
  'composer.label': 'Message Rashid',
  'composer.placeholder': 'Ask Rashid anything about your city…',
  'settings.title': 'Conversation settings',
  'settings.close': 'Close settings',
  'settings.language': 'Language',
  'settings.shareProfile': 'Share my profile details with the assistant',
  'settings.readReplies': 'Read replies aloud',
  'message.you': 'You',
  'message.tryAgain': 'Try again',
  'connections.title': 'Connections',
  'connections.intro': 'The services your concierge talks to, the operations each one advertises, and the calls made for you. Providers are read at most every 30 seconds.',
  'connections.check': 'Check connections',
  'connections.loading': 'Loading connections…',
  'connections.checking': 'Checking connections…',
  'connections.unavailable': 'Connections are unavailable.',
  'connections.allReachable': 'All {count} connections are reachable.',
  'connections.someProblem': '{problems} of {count} connections have a problem.',
  'connections.connectionLabel': '{name} connection',
  'connections.reachableOne': 'Reachable · 1 operation advertised',
  'connections.reachableMany': 'Reachable · {count} operations advertised',
  'connections.refused': 'Refused · {reason}',
  'connections.unknownProblem': 'unknown problem',
  'connections.showOperations': 'Show operations for {name}',
  'connections.operationsLabel': '{name} operations',
  'connections.caption': 'Advertised operations',
  'connections.operation': 'Operation',
  'connections.method': 'Method',
  'connections.path': 'Path',
  'connections.recent': 'Recent calls',
  'connections.recentLabel': 'Recent provider calls',
  'connections.noCalls': 'No calls have been made for you yet.',
  'connections.callOk': 'OK {status}',
  'connections.callFailed': 'Failed {status}',
  'connections.ms': '{ms} ms',
  'delegation.title': 'Delegated access',
  'delegation.intro': 'Let the Cityside demo broker perform one exact operation on your current account. Consent expires in five minutes and can be revoked here.',
  'delegation.actor': 'Actor:',
  'delegation.actorValue': 'Cityside delegation broker.',
  'delegation.scope': 'Scope:',
  'delegation.scopeValue': 'the displayed account and operation only. Synthetic data.',
  'delegation.allowReads': 'Allow up to 3 wallet balance checks',
  'delegation.allowCredit': 'Approve one AED 1 demo wallet credit',
  'delegation.refresh': 'Refresh grants',
  'delegation.checking': 'Checking current authority…',
  'delegation.saved': 'Consent saved. Review the grant below before running it.',
  'delegation.readBalance': 'Read the wallet balance',
  'delegation.creditWallet': 'Credit the demo wallet by {amount}',
  'delegation.revoked': 'Revoked',
  'delegation.expired': 'Expired',
  'delegation.active': 'Active',
  'delegation.status': '{state} · {used}/{max} executions · expires {time}',
  'delegation.run': 'Run approved operation',
  'delegation.revoke': 'Revoke consent',
  'delegation.revokedNotice': 'Consent revoked. Further delegated operations will be denied.',
  'delegation.history': 'View audit history',
  'delegation.historyLabel': 'Delegation audit history',
  'delegation.none': 'No delegated grants for this account.',
} as const;

export type CatalogKey = keyof typeof en;
const ar: Record<CatalogKey, string> = {
  'app.newConversation': 'محادثة جديدة',
  'nav.yourSpace': 'مساحتك',
  'nav.yourConcierge': 'مساعدك الشخصي',
  'nav.conversations': 'المحادثات',
  'nav.exploreServices': 'استكشف الخدمات',
  'nav.myProfile': 'ملفي الشخصي',
  'nav.currentAccount': 'الحساب الحالي',
  'nav.signOut': 'تسجيل الخروج',
  'nav.open': 'فتح القائمة',
  'nav.close': 'إغلاق القائمة',
  'nav.closeMenu': 'إغلاق قائمة التنقل',
  'service.mobility': 'التنقل',
  'service.utilities': 'المرافق',
  'service.citizenpay': 'المدفوعات',
  'service.telecom': 'الاتصالات',
  'service.housing': 'السكن',
  'tools.delegatedAccess': 'الوصول المفوّض',
  'tools.connections': 'روابط الخدمات',
  'tools.paymentAccounts': 'حسابات الدفع',
  'footer.madeForLife': 'صُنع للحياة في دبي',
  'footer.cityServices': 'خدمات المدينة في محادثة واحدة.',
  'status.demoMode': 'الوضع التجريبي',
  'composer.label': 'رسالة إلى راشد',
  'composer.placeholder': 'اسأل راشد أي شيء عن مدينتك…',
  'settings.title': 'إعدادات المحادثة',
  'settings.close': 'إغلاق الإعدادات',
  'settings.language': 'اللغة',
  'settings.shareProfile': 'مشاركة بيانات ملفي الشخصي مع المساعد',
  'settings.readReplies': 'قراءة الردود بصوت عالٍ',
  'message.you': 'أنت',
  'message.tryAgain': 'حاول مرة أخرى',
  'connections.title': 'روابط الخدمات',
  'connections.intro': 'الخدمات التي يتحدث معها مساعدك، والعمليات التي تعلنها كل خدمة، والاستدعاءات التي أُجريت لك. تُقرأ بيانات الجهات مرة كل 30 ثانية على الأكثر.',
  'connections.check': 'فحص الروابط',
  'connections.loading': 'جارٍ تحميل الروابط…',
  'connections.checking': 'جارٍ فحص الروابط…',
  'connections.unavailable': 'الروابط غير متاحة.',
  'connections.allReachable': 'جميع الروابط ({count}) متاحة.',
  'connections.someProblem': '{problems} من أصل {count} اتصالات بها مشكلة.',
  'connections.connectionLabel': 'رابط {name}',
  'connections.reachableOne': 'متاح · عملية واحدة معلنة',
  'connections.reachableMany': 'متاح · {count} عملية معلنة',
  'connections.refused': 'مرفوض · {reason}',
  'connections.unknownProblem': 'مشكلة غير معروفة',
  'connections.showOperations': 'عرض عمليات {name}',
  'connections.operationsLabel': 'عمليات {name}',
  'connections.caption': 'العمليات المعلنة',
  'connections.operation': 'العملية',
  'connections.method': 'الطريقة',
  'connections.path': 'المسار',
  'connections.recent': 'الاستدعاءات الأخيرة',
  'connections.recentLabel': 'استدعاءات الجهات الأخيرة',
  'connections.noCalls': 'لم تُجرَ أي استدعاءات لك بعد.',
  'connections.callOk': 'نجح {status}',
  'connections.callFailed': 'فشل {status}',
  'connections.ms': '{ms} ملّي ثانية',
  'delegation.title': 'الوصول المفوّض',
  'delegation.intro': 'اسمح لوسيط كيتي سايد التجريبي بتنفيذ عملية واحدة محددة على حسابك الحالي. تنتهي الموافقة بعد خمس دقائق ويمكنك إلغاؤها من هنا.',
  'delegation.actor': 'الجهة المنفذة:',
  'delegation.actorValue': 'وسيط التفويض في كيتي سايد.',
  'delegation.scope': 'النطاق:',
  'delegation.scopeValue': 'الحساب والعملية المعروضان فقط. بيانات تجريبية.',
  'delegation.allowReads': 'السماح بما يصل إلى 3 عمليات للاطلاع على رصيد المحفظة',
  'delegation.allowCredit': 'الموافقة على إضافة درهم واحد تجريبي إلى المحفظة',
  'delegation.refresh': 'تحديث التفويضات',
  'delegation.checking': 'جارٍ التحقق من الصلاحية الحالية…',
  'delegation.saved': 'تم حفظ الموافقة. راجع التفويض أدناه قبل تشغيله.',
  'delegation.readBalance': 'الاطلاع على رصيد المحفظة',
  'delegation.creditWallet': 'إضافة {amount} إلى المحفظة التجريبية',
  'delegation.revoked': 'ملغى',
  'delegation.expired': 'منتهي',
  'delegation.active': 'ساري',
  'delegation.status': '{state} · {used}/{max} عمليات تنفيذ · ينتهي {time}',
  'delegation.run': 'تشغيل العملية المعتمدة',
  'delegation.revoke': 'إلغاء الموافقة',
  'delegation.revokedNotice': 'تم إلغاء الموافقة. ستُرفض العمليات المفوّضة اللاحقة.',
  'delegation.history': 'عرض سجل التدقيق',
  'delegation.historyLabel': 'سجل تدقيق التفويض',
  'delegation.none': 'لا توجد تفويضات لهذا الحساب.',
};

export const CATALOGS: Readonly<Record<Locale, Readonly<Record<CatalogKey, string>>>> = { en, ar };

export const isLocale = (value: unknown): value is Locale => (LOCALES as readonly unknown[]).includes(value);
/** The locale a browser asks for when the resident has not chosen: Arabic only when it is the first language asked for. */
export const preferredLocale = (languages: readonly string[] | undefined): Locale => (languages?.[0] ?? '').toLowerCase().startsWith('ar') ? 'ar' : DEFAULT_LOCALE;
export const direction = (locale: Locale): 'ltr' | 'rtl' => locale === 'ar' ? 'rtl' : 'ltr';
/** The BCP 47 tag used for formatting; Latin digits are requested explicitly. */
export const formatTag = (locale: Locale) => locale === 'ar' ? 'ar-AE-u-nu-latn' : 'en-AE';

/** Text for a key, with {name} placeholders filled; a missing key falls back to English, never to an empty label. */
export function translate(locale: Locale, key: CatalogKey, values: Record<string, string | number> = {}): string {
  const template = CATALOGS[locale]?.[key] ?? en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match);
}

/** Whole-fils money as the currency's own formatting: integer minor units in, never a float of money. */
export function formatMoney(locale: Locale, minor: number, currency = 'AED', options: { grouping?: boolean } = {}): string {
  if (!Number.isSafeInteger(minor)) throw new Error('Money is a whole number of minor units.');
  const sign = minor < 0 ? -1 : 1, abs = Math.abs(minor);
  const whole = Math.trunc(abs / 100), cents = abs % 100;
  // Format the whole part with the locale's grouping and keep the two decimals as digits, so no float ever carries the amount.
  const grouped = new Intl.NumberFormat(formatTag(locale), { useGrouping: options.grouping ?? true, maximumFractionDigits: 0 }).format(whole);
  const decimal = locale === 'ar' ? '٫' : '.';
  const amount = `${grouped}${decimal}${String(cents).padStart(2, '0')}`;
  return locale === 'ar' ? `${sign < 0 ? '-' : ''}${amount} ${currency === 'AED' ? 'د.إ' : currency}` : `${sign < 0 ? '-' : ''}${currency} ${amount}`;
}
export const formatDateTime = (locale: Locale, at: number | Date) => new Intl.DateTimeFormat(formatTag(locale), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' }).format(at);
export const formatTime = (locale: Locale, at: number | Date) => new Intl.DateTimeFormat(formatTag(locale), { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Dubai' }).format(at);
