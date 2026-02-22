#!/usr/bin/env python3
"""
gmail_oauth_setup.py
--------------------
One-time helper to obtain a Gmail OAuth 2.0 refresh token.

Run this script ONCE from the backend directory:

    pip install google-auth-oauthlib
    python gmail_oauth_setup.py

You will need a Google Cloud project with the Gmail API enabled and an
OAuth 2.0 Client ID (type: Desktop app).  Download the client credentials
from the Cloud Console and paste the client_id and client_secret when prompted
(or pass them via --client-id / --client-secret).

After authenticating in your browser the script prints the three .env values
you need to copy into backend/.env:

    GMAIL_CLIENT_ID=...
    GMAIL_CLIENT_SECRET=...
    GMAIL_REFRESH_TOKEN=...

Quick start:
    1. Go to https://console.cloud.google.com/apis/credentials
    2. Click "Create Credentials" → "OAuth client ID" → Desktop app
    3. Copy the Client ID and Client Secret
    4. Run: python gmail_oauth_setup.py
    5. Paste the values printed at the end into backend/.env
"""

import argparse
import sys


def main() -> None:
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        sys.exit(
            "google-auth-oauthlib is not installed.\n"
            "Run: pip install google-auth-oauthlib\n"
            "then re-run this script."
        )

    parser = argparse.ArgumentParser(
        description="Obtain a Gmail OAuth2 refresh token for CoverageIQ.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--client-id",     default="", help="OAuth2 Client ID (or enter interactively)")
    parser.add_argument("--client-secret", default="", help="OAuth2 Client Secret (or enter interactively)")
    args = parser.parse_args()

    client_id     = args.client_id     or input("OAuth2 Client ID     : ").strip()
    client_secret = args.client_secret or input("OAuth2 Client Secret : ").strip()

    if not client_id or not client_secret:
        sys.exit("Both Client ID and Client Secret are required.")

    flow = InstalledAppFlow.from_client_config(
        {
            "installed": {
                "client_id":      client_id,
                "client_secret":  client_secret,
                "redirect_uris":  ["urn:ietf:wg:oauth:2.0:oob", "http://localhost"],
                "auth_uri":       "https://accounts.google.com/o/oauth2/auth",
                "token_uri":      "https://oauth2.googleapis.com/token",
            }
        },
        scopes=["https://www.googleapis.com/auth/gmail.readonly"],
    )

    print("\nOpening your browser for Google authentication…")
    print("(If it does not open automatically, copy the URL printed below.)\n")

    creds = flow.run_local_server(port=0, prompt="consent", access_type="offline")

    if not creds.refresh_token:
        sys.exit(
            "\nNo refresh token was returned. This usually happens when the account "
            "has already authorized this app. Revoke access at "
            "https://myaccount.google.com/permissions and re-run this script."
        )

    print("\n" + "=" * 60)
    print("✅  Authentication successful!  Add these lines to backend/.env:")
    print("=" * 60 + "\n")
    print(f"GMAIL_CLIENT_ID={client_id}")
    print(f"GMAIL_CLIENT_SECRET={client_secret}")
    print(f"GMAIL_REFRESH_TOKEN={creds.refresh_token}")
    print(f"GMAIL_USER_EMAIL=me")
    print()


if __name__ == "__main__":
    main()
