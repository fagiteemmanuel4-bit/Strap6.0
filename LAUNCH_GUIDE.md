# Strap: launch guide (phone + Code Studio) - Neon Auth version

## How it works now
- **Neon Auth** creates accounts, stores passwords, and **emails the 6-digit codes** (sign up, forgot password).
- **Neon database** stores your dashboard data and **images**.
- Vercel runs the small backend in `api/[...route].js`. Online store = "coming soon".
- Welcome + support emails are not part of Neon Auth. They use Resend and are OPTIONAL (skip it and codes still work).

## Step 1: Neon database
1. neon.com > create project.
2. **SQL Editor** > paste all of `schema.sql` > Run.
3. **Connect** > pooled connection string = `DATABASE_URL`.

## Step 2: Turn on Neon Auth
1. In your Neon project open **Auth** > Enable.
2. Copy the **Auth URL** = `NEON_AUTH_BASE_URL`.
3. Open Auth settings > **Email & password**: turn ON sign-up, ON "require email verification", set verification method to **Verification code (OTP)**, and turn ON "sign in after verification".
4. (Do this after Step 3) **Domains** > add your Vercel address (e.g. https://your-project.vercel.app) as a trusted domain.
5. Emails: the default shared Neon sender works for testing. For your own sender use Auth > Email > custom SMTP.

## Step 3: Put it online
1. Unzip. GitHub (browser) > new private repo > upload ALL files + the `api` folder (keep the name `api/[...route].js`).
2. vercel.com > Add New Project > pick repo > add Environment Variables from `.env.example`: `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `SITE_URL`, `APP_NAME` (and optionally `RESEND_API_KEY`, `MAIL_FROM`, `SUPPORT_EMAIL`) > Deploy.
3. Do Step 2.4 now with the real address. Then in Vercel press **Redeploy**.

## Check it works
Open `https://YOUR-SITE/api/health`. You want: `{"db":true,"auth":true,...}`.
- `db:false` = wrong DATABASE_URL or schema not run.
- `auth:false` = wrong NEON_AUTH_BASE_URL (copy the Auth URL again).
Then test: sign up with a real email > code arrives from Neon > finish setup > sign out > sign in > forgot password > change password.

## If something fails
- Vercel > project > **Logs**. Send me the exact error text and I will fix it.
- Sign-up says "Invalid origin" or similar = your site is not in Neon Auth > Domains, or SITE_URL has a typo/slash.
- No code email: check spam, then Neon Auth email settings (shared sender or SMTP).

## Known limits
- Written from Neon's documentation and not yet tested against your live Neon project, so use the health check and send me any error.
- Account deletion removes your app data and images; removing the login itself only works if account deletion is enabled in Neon Auth.
- If someone verifies their email but quits before finishing the business questions, they are asked to sign up again.
- The security email/phone code step in the subscribe screen and the payments screen are still demo.
- Support form: call `StrapAPI.contact('support','message','user@email.com')`.
