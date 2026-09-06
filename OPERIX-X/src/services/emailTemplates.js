function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[character]));
}

function detailRow(label, value) {
  return `<tr>
    <td style="padding:12px 0;border-bottom:1px solid rgba(148,163,184,0.14);font-size:12px;color:#94a3b8;vertical-align:top;width:34%;">${escapeHtml(label)}</td>
    <td align="left" style="padding:12px 0;border-bottom:1px solid rgba(148,163,184,0.14);font-size:13px;color:#e2e8f0;word-break:break-word;direction:ltr;text-align:left;">${escapeHtml(value)}</td>
  </tr>`;
}

function renderEmailTemplate({
  title,
  preheader,
  heading,
  description,
  actionText,
  actionUrl,
  highlightTitle,
  highlightValue,
  details = [],
  secondaryText,
  footerNote = 'هذا البريد تم إرساله تلقائيًا من OPERIX. يرجى عدم الرد عليه.'
}) {
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader || '');
  const safeHeading = escapeHtml(heading);
  const safeDescription = escapeHtml(description || '');
  const safeActionText = escapeHtml(actionText || 'إجراء الآن');
  const safeActionUrl = escapeHtml(actionUrl || '#');
  const safeHighlightTitle = escapeHtml(highlightTitle || '');
  const safeHighlightValue = escapeHtml(highlightValue || '');
  const safeSecondaryText = escapeHtml(secondaryText || '');
  const safeFooterNote = escapeHtml(footerNote);
  const detailRows = details.map(({ label, value }) => detailRow(label, value)).join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#060d18;font-family:Tahoma,Arial,sans-serif;color:#e2e8f0;">
    <div style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;">${safePreheader}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#060d18;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;background:#0d1726;border:1px solid #26364b;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="background:#eeb34e;padding:20px 28px;border-bottom:4px solid #c58a28;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="right" style="font-size:25px;font-weight:700;color:#08111e;letter-spacing:1px;">OPERIX</td>
                    <td align="left" style="font-size:11px;font-weight:700;color:#374151;letter-spacing:1px;">SECURE FINANCE</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px 10px;">
                <div style="font-size:11px;color:#eeb34e;font-weight:700;letter-spacing:1.5px;margin-bottom:12px;">إشعار رسمي من OPERIX</div>
                <h1 style="margin:0 0 12px;font-size:28px;line-height:1.35;color:#f8fafc;font-weight:700;">${safeHeading}</h1>
                <p style="margin:0;font-size:15px;line-height:1.9;color:#cbd5e1;">${safeDescription}</p>
              </td>
            </tr>
            ${highlightTitle && highlightValue ? `
            <tr>
              <td style="padding:12px 28px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#111f32;border:1px solid #33465e;border-radius:14px;">
                  <tr>
                    <td align="center" style="padding:20px;">
                      <div style="font-size:11px;color:#a9b6c7;letter-spacing:0.5px;">${safeHighlightTitle}</div>
                      <div style="margin-top:8px;font-size:28px;line-height:1.2;font-weight:700;color:#f5c96d;letter-spacing:3px;direction:ltr;">${safeHighlightValue}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            ` : ''}
            ${details.length ? `
            <tr>
              <td style="padding:20px 28px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${detailRows}</table>
              </td>
            </tr>
            ` : ''}
            ${actionText && actionUrl && actionUrl !== '#' ? `
            <tr>
              <td style="padding:26px 28px 8px;">
                <a href="${safeActionUrl}" style="display:inline-block;text-decoration:none;background:#eeb34e;color:#08111e;font-weight:700;padding:15px 26px;border-radius:9px;font-size:15px;">${safeActionText}</a>
                <p style="margin:16px 0 0;font-size:11px;line-height:1.7;color:#8190a3;word-break:break-all;direction:ltr;text-align:left;">إذا لم يعمل الزر، افتح الرابط التالي مباشرة:<br /><a href="${safeActionUrl}" style="color:#eeb34e;">${safeActionUrl}</a></p>
              </td>
            </tr>
            ` : ''}
            ${safeSecondaryText ? `
            <tr>
              <td style="padding:0 28px 10px;">
                <p style="margin:0;font-size:13px;line-height:1.8;color:#94a3b8;">${safeSecondaryText}</p>
              </td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding:18px 28px 30px;">
                <div style="border-top:1px solid #26364b;padding-top:18px;font-size:12px;color:#8190a3;line-height:1.8;">${safeFooterNote}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function emailVerificationTemplate({ verifyUrl, userEmail }) {
  return renderEmailTemplate({
    title: 'تأكيد البريد الإلكتروني',
    preheader: 'أكد بريدك الإلكتروني للوصول إلى حسابك في OPERIX',
    heading: 'تأكيد بريدك الإلكتروني',
    description: `أهلاً بك في OPERIX. لتفعيل حسابك والبدء في استخدام المنصة، يرجى تأكيد بريدك الإلكتروني.`,
    actionText: 'تأكيد الحساب',
    actionUrl: verifyUrl,
    highlightTitle: 'البريد الإلكتروني',
    highlightValue: userEmail || 'user@operix.website',
    secondaryText: 'إذا لم تقم بإنشاء الحساب، يمكنك تجاهل هذه الرسالة بأمان.',
    footerNote: 'جميع الحقوق محفوظة © 2026 OPERIX. هذا البريد تم إرساله تلقائيًا، يرجى عدم الرد عليه.'
  });
}

function passwordResetTemplate({ otp, expiresInMinutes = 10 }) {
  return renderEmailTemplate({
    title: 'استعادة كلمة المرور',
    preheader: 'رمز الأمان الخاص بك لإعادة تعيين كلمة المرور',
    heading: 'استعادة كلمة المرور',
    description: `استخدم رمز الأمان التالي لإعادة تعيين كلمة المرور في حسابك. الرمز صالح لمدة ${expiresInMinutes} دقيقة فقط.`,
    actionText: '',
    actionUrl: '#',
    highlightTitle: 'رمز التحقق',
    highlightValue: otp,
    details: [{ label: 'نوع العملية', value: 'إعادة تعيين كلمة المرور' }, { label: 'مدة الصلاحية', value: `${expiresInMinutes} دقائق` }],
    secondaryText: 'لا تشارك هذا الرمز مع أي شخص. إذا لم تطلب إعادة تعيين كلمة المرور، يرجى تجاهل هذه الرسالة.',
    footerNote: 'أمان حسابك مهم لنا. إذا كنت بحاجة إلى المساعدة، تواصل مع فريق الدعم في OPERIX.'
  });
}

function twoFactorTemplate({ code, expiresInMinutes = 5 }) {
  return renderEmailTemplate({
    title: 'رمز التحقق الثنائي',
    preheader: 'رمز تحققك الثنائي لتأكيد العملية الحساسة',
    heading: 'تأكيد العملية الآمنة',
    description: `استخدم رمز الأمان التالي لإكمال العملية الحالية. الرمز صالح لمدة ${expiresInMinutes} دقائق فقط.`,
    actionText: '',
    actionUrl: '#',
    highlightTitle: 'رمز التحقق الثنائي',
    highlightValue: code,
    details: [{ label: 'نوع العملية', value: 'تأكيد عملية سحب' }, { label: 'مدة الصلاحية', value: `${expiresInMinutes} دقائق` }],
    secondaryText: 'إذا لم تكن أنت من أجرى هذه العملية، يرجى تغيير كلمة المرور فورًا وتسجيل الخروج من جميع الجلسات.',
    footerNote: 'تم إرسال هذا البريد تلقائيًا لحماية حسابك في OPERIX.'
  });
}

function withdrawalRequestTemplate({ amount, transactionId, walletAddress, requestedAt }) {
  return renderEmailTemplate({
    title: 'تم تقديم طلب سحب جديد',
    preheader: 'تم تسجيل طلب السحب الخاص بك بنجاح',
    heading: 'تم تقديم طلب السحب بنجاح',
    description: 'تم استلام طلب السحب الخاص بك في منصتنا. سيتم مراجعة الطلب وفقًا لسياسات الأمان والرسوم المطبقة.',
    actionText: 'مراجعة الطلب',
    actionUrl: `${process.env.APP_URL || 'https://operix.website'}/status.html`,
    highlightTitle: 'معلومات الطلب',
    highlightValue: `${amount} USDT`,
    details: [
      { label: 'معرف الطلب', value: transactionId },
      { label: 'عنوان المحفظة', value: walletAddress },
      ...(requestedAt ? [{ label: 'تاريخ الطلب', value: requestedAt }] : [])
    ],
    secondaryText: 'تم وضع الطلب في حالة المراجعة. ستتلقى إشعارًا جديدًا عند تحديث حالته.',
    footerNote: 'يرجى ملاحظة أن طلبات السحب تخضع لمراجعة الأمان وقد تستغرق بعض الوقت حسب نشاط الحساب.'
  });
}

function withdrawalCompletedTemplate({ amount, transactionId, walletAddress, completedAt }) {
  return renderEmailTemplate({
    title: 'تم إتمام عملية السحب',
    preheader: 'تمت الموافقة على طلب السحب وتحويل المبلغ',
    heading: 'تم إتمام عملية السحب بنجاح',
    description: 'تمت مراجعة طلب السحب الخاص بك والموافقة عليه. سيظهر المبلغ في محفظتك الإلكترونية وفقًا لوقت تأكيد الشبكة.',
    actionText: 'فتح المنصة',
    actionUrl: `${process.env.APP_URL || 'https://operix.website'}/`,
    highlightTitle: 'المبلغ المحول',
    highlightValue: `${amount} USDT`,
    details: [
      { label: 'معرف العملية', value: transactionId },
      { label: 'عنوان المحفظة', value: walletAddress },
      { label: 'تاريخ التنفيذ', value: completedAt }
    ],
    secondaryText: 'شكرًا لثقتك في OPERIX. احتفظ بهذا البريد كمرجع للعملية.',
    footerNote: 'تم إرسال هذا الإشعار تلقائيًا من OPERIX بعد اعتماد العملية.'
  });
}

function adminInviteTemplate({ inviteUrl, role }) {
  return renderEmailTemplate({
    title: 'دعوة دخول الإدارة',
    preheader: 'تمت دعوتك إلى لوحة إدارة OPERIX',
    heading: 'دعوة دخول الإدارة',
    description: `تمت دعوتك للانضمام إلى فريق إدارة OPERIX بدور ${role}. يرجى إكمال إعداد الحساب للوصول إلى لوحة الإدارة.`,
    actionText: 'إكمال الإعداد',
    actionUrl: inviteUrl,
    highlightTitle: 'الدور',
    highlightValue: role,
    secondaryText: 'الرابط صالح لمدة 24 ساعة فقط. إذا كانت لديك أي أسئلة، تواصل مع فريق الدعم.',
    footerNote: 'هذا البريد تم إرساله من النظام الرسمي لـ OPERIX.'
  });
}

module.exports = {
  renderEmailTemplate,
  emailVerificationTemplate,
  passwordResetTemplate,
  twoFactorTemplate,
  withdrawalRequestTemplate,
  withdrawalCompletedTemplate,
  adminInviteTemplate
};
