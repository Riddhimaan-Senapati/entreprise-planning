"""
Slack Time-Off Parser — CLI
Prints detected time-off entries to the terminal.

Usage:
    python fetch_timeoff.py
    python fetch_timeoff.py --hours 48
    python fetch_timeoff.py --limit 50
"""

import argparse
import os
import sys

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

from slack_parser import TimeOffEntry, fetch_and_parse

load_dotenv()

SLACK_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN")
SLACK_CHANNEL_ID = os.getenv("SLACK_CHANNEL_ID")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if GEMINI_API_KEY and not os.getenv("GOOGLE_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = GEMINI_API_KEY

missing = [k for k, v in {
    "SLACK_BOT_TOKEN": SLACK_BOT_TOKEN,
    "SLACK_CHANNEL_ID": SLACK_CHANNEL_ID,
    "GEMINI_API_KEY": GEMINI_API_KEY,
}.items() if not v]

if missing:
    print(f"ERROR: Missing environment variables: {', '.join(missing)}")
    sys.exit(1)


def print_entry(entry: TimeOffEntry) -> None:
    print("\n" + "─" * 60)
    print(f"  Sent at   : {entry.sent_at}")
    print(f"  From      : @{entry.sender}")
    print(f"  Message   : {entry.message[:120]!r}")
    print("  ✦ TIME-OFF DETECTED")
    print(f"  Person    : @{entry.person_username}")
    print(f"  Off from  : {entry.start_date or '(not specified)'}")
    print(f"  Off until : {entry.end_date or '(not specified)'}")
    print(f"  Reason    : {entry.reason or '(not mentioned)'}")
    print(f"  Coverage  : {'@' + entry.coverage_username if entry.coverage_username else '(not mentioned)'}")
    if entry.notes:
        print(f"  Notes     : {entry.notes}")


def main(hours_back: int, limit: int) -> None:
    slack = WebClient(token=SLACK_BOT_TOKEN)

    try:
        channel_name = slack.conversations_info(channel=SLACK_CHANNEL_ID)["channel"]["name"]
    except SlackApiError as e:
        print(f"ERROR: Cannot access channel — {e.response['error']}")
        sys.exit(1)

    print("Slack Time-Off Parser")
    print("=" * 60)
    print(f"Channel     : #{channel_name} ({SLACK_CHANNEL_ID})")
    print(f"Looking back: {hours_back} hours  |  max messages: {limit}")

    entries = fetch_and_parse(slack, SLACK_CHANNEL_ID, hours_back, limit)

    if not entries:
        print("\nNo time-off messages found.")
    else:
        for entry in entries:
            print_entry(entry)

    print(f"\n{'=' * 60}")
    print(f"Done. Found {len(entries)} time-off message(s).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Parse Slack messages for time-off requests.")
    parser.add_argument("--hours", type=int, default=24)
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()
    main(hours_back=args.hours, limit=args.limit)
