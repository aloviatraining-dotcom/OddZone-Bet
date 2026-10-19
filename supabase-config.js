window.ODDZONE_CONFIG = {
    supabase: {
        url: 'https://csrfrzzpduhhzldirdfi.supabase.co',
        anonKey: 'sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj'
    },
    paystack: {
        // PUBLIC key only. The secret key must never be shipped to the browser:
        // anyone can read it in DevTools and use it to move money.
        // It now lives in the verify-identity edge function secret instead
        // (supabase secrets set PAYSTACK_SECRET_KEY=sk_...).
        publicKey: 'pk_test_2266fed5ac96b7e91b9bbef5f500be972f4992e3'
    },
    // Real signup verification codes.
    // Fill these in from https://www.emailjs.com to enable email delivery:
    //   serviceId  -> Email Services  (connect your Gmail/Outlook account)
    //   templateId -> Email Templates (must use {{to_email}}, {{otp_code}})
    //   publicKey  -> Account > Public Key
    // While these are blank, signup will show a clear "not configured" message
    // instead of pretending a code was emailed.
    emailjs: {
        serviceId: 'service_ucxojy9',
        templateId: 'template_oxjb59j',
        publicKey: '9yavMN8PsOYAbcc7v',
        // Separate template for the post-signup welcome email.
        // Must use {{to_email}} and {{username}}.
        welcomeTemplateId: 'template_kk9r48n'
    },
    // Set to true to require a 6-digit email code before an account is created.
    //
    // Currently FALSE: signup creates the account immediately. The email path
    // was unreliable in practice (EmailJS free-plan quota, rate limiting, and
    // Gmail throttling mail from a personal account), which left people unable
    // to register at all.
    //
    // Trade-off: with this off, anyone can register with any email address and
    // without proving they own it. That is fine for opening the app to users.
    // Before you let anyone deposit real money, set this to true and use a
    // dedicated transactional mail provider rather than a personal Gmail —
    // and keep email verification enforced on the server, not just in this file.
    requireEmailVerification: false
};

// Backwards-compatibility alias for Supabase config
window.ODDZONE_SUPABASE_CONFIG = window.ODDZONE_CONFIG.supabase;
