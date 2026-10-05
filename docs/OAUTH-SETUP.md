# Real OAuth setup, step by step

Keep client secrets in the gitignored `.env` file. Do not put them into the frontend, screenshots, commit history, or chat. The app requests basic Google identity and one Slack channel webhook only.

## 1. Google

1. Open [Google Cloud Console](https://console.cloud.google.com/) using your own Google account.
2. Create/select a project named **ReachInbox Scheduler**. Open **Google Auth Platform → Branding**.
3. If prompted, choose **Get started**. Set the app name to ReachInbox Scheduler, use your own support/contact email, and choose **External** audience. Review the policy yourself and complete the setup.
4. In **Audience → Test users**, add the Google email you will use for the demo. Keep the app in Testing for local review.
5. In **Clients → Create client**, choose **Web application**. Name it **ReachInbox Local**.
6. Under **Authorized redirect URIs**, add exactly:

   ```text
   http://localhost:4000/api/auth/google/callback
   ```

7. Create the client and copy its **client ID** and **client secret** into the root `.env`:

   ```dotenv
   GOOGLE_CLIENT_ID=<your-id>.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=<your-secret>
   ```

8. Restart the API (`npm run dev -w @reachinbox/api`, or stop/start the API process). Visit **http://localhost:5173**, log out of demo access, and click **Continue with Google**.
9. Choose your test user and consent. Confirm that the dashboard shows your real name, email and avatar, then check Logout and sign-in again.
10. Add that same email to `QUEUE_ADMIN_EMAILS` in `.env` and restart the API if you want live queue access.

The callback must exactly match the registered URI, including scheme, hostname, port and path. Use `localhost`, not `127.0.0.1`, for the browser flow so the session cookie is shared with the callback. Only `openid`, `email`, and `profile` are requested.

You can also download the client JSON from **Google Auth Platform → Clients → your Web application**. Keep it outside the repository, then run:

```sh
npm run google:import -- "C:/Users/your-name/Downloads/client_secret.json"
```

The helper verifies the Web client and registered callback, preserves other `.env` settings, and imports the ID/secret without displaying them. The full OAuth client ID ends in `.apps.googleusercontent.com`; the project ID, project number and client secret are separate fields.

If Google reports `redirect_uri_mismatch`, inspect the authorized callback and `API_URL`. If it reports that the app is blocked in testing, add your chosen account under Audience/Test users. Provider configuration can take a short time to propagate.

Official references: [Google consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent), [Web OAuth flow and ID-token verification](https://developers.google.com/identity/protocols/oauth2/web-server).

## 2. Slack

1. Sign in to your Slack workspace. If you do not have one, create a workspace yourself first.
2. Open [Slack Apps](https://api.slack.com/apps), choose **Create New App → From scratch**, name it **ReachInbox Scheduler**, and select your workspace.
3. Open **Incoming Webhooks** and turn **Activate Incoming Webhooks** on.
4. Open **OAuth & Permissions**. Under **Redirect URLs**, add and save:

   ```text
   http://localhost:4000/api/integrations/slack/callback
   ```

5. Under **Bot Token Scopes**, ensure **incoming-webhook** is listed. The OAuth flow will ask you to choose the notification channel; a hand-pasted webhook alone is not a substitute for the required flow.
6. Under **Basic Information → App Credentials**, copy **Client ID** and **Client Secret** into `.env`:

   ```dotenv
   SLACK_CLIENT_ID=<your-client-id>
   SLACK_CLIENT_SECRET=<your-client-secret>
   ```

7. Restart the API. In the dashboard, go to **Integrations → Connect Slack**. Approve the workspace and select a channel such as `#scheduler-demo`.
8. Confirm that the connection card shows your workspace/channel.
9. Create a **fresh sender** for the demo. Compose an email to two sample recipients with **Hourly limit = 1**, a future start time, and the normal 2-second minimum delay.
10. Watch the actual message arrive in Slack as the first send slot reaches the allowance. One email sends; the next becomes **Rate limited** and waits for the next UTC hour. Show the real Slack message and Notification activity in the demo.
11. Disconnect in the dashboard, then connect again through OAuth. The worker reads the current connection on every event; no worker redeploy is needed.

If your Slack console refuses an HTTP callback, use an HTTPS development tunnel, set `API_URL` to the tunnel URL, register that exact callback, and restart the API. Keep the browser/app origin and cookie configuration consistent; for the simplest tunnel setup expose the complete built app through one HTTPS origin and set both `APP_URL` and `API_URL` to it.

Official references: [Slack OAuth installation](https://docs.slack.dev/authentication/installing-with-oauth), [Incoming webhook OAuth setup](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks).

## 3. Before the final recording

- Real Google account signs in and appears in the header.
- Slack is connected using the dashboard's OAuth flow.
- A fresh real Ethereal sender is available.
- At least one scheduled email produces a real Ethereal preview.
- The rate-limit demo produces an actual message in your chosen Slack channel.
- The screen recording does not show client secrets, SMTP passwords, or webhook URLs.
