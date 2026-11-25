# Strap billing email setup (EmailJS)

Strap uses one EmailJS template for Premium billing emails. The server sends through EmailJS REST API; no EmailJS private key is required by the current implementation.

## 1. Create the EmailJS service

1. Sign in at https://dashboard.emailjs.com/
2. Add and verify the email service that should send Strap billing messages.
3. Copy its Service ID.

## 2. Create one reusable email template

Create a template named **Strap Billing Updates**.

Set:
- **To Email:** `{{to_email}}`
- **To Name:** `{{to_name}}`
- **Subject:** `{{subject}}`

Suggested body:

```text
Hello {{to_name}},

{{message}}

Business: {{business_name}}
Event: {{event_type}}
Amount: {{currency}} {{amount}}
Payment reference: {{tx_ref}}
Premium expiry: {{expires_at}}

Manage your billing:
{{action_url}}

— Strap
```

Save and copy the Template ID. All billing events share this template: successful payments, unsuccessful payments, renewal reminders and test messages.

## 3. Add these Vercel Production environment variables

| Variable | Value |
| --- | --- |
| `EMAILJS_SERVICE_ID` | Service ID from step 1 |
| `EMAILJS_TEMPLATE_ID` | Template ID from step 2 |
| `EMAILJS_PUBLIC_KEY` | EmailJS account Public Key |
| `CRON_SECRET` | A long, random secret (at least 32 characters) |

Do not add the EmailJS private key. The application does not need it.

After saving the variables, redeploy Strap6.0 to Production.

## 4. Verify delivery

1. Open Strap → Billing → Billing notifications.
2. Enable the email types you want.
3. Tap **Send test email to my account**.
4. Confirm the email arrives in the account's inbox (and check spam if needed).

## 5. Scheduled renewal reminders

Vercel Cron calls `/api/billing/cron` every day at 09:00 UTC (10:00 in Nigeria). Vercel sends `Authorization: Bearer <CRON_SECRET>`; the route rejects requests without the matching secret.

Users can choose reminders 14, 7, 3 or 1 day(s) before expiry. A unique event key prevents the same reminder from being sent twice for the same expiry date.

## Email template variables

`to_email`, `to_name`, `subject`, `message`, `event_type`, `amount`, `currency`, `tx_ref`, `expires_at`, `business_name`, `action_url`.

## Notes

- Billing emails are optional until EmailJS is configured. Payment verification and Premium entitlement do not depend on email delivery.
- EmailJS currently documents a limit of one send request per second. Strap's scheduled reminder worker spaces messages to respect that limit.
- Email delivery depends on the sender service connected to EmailJS and the template's recipient settings.
