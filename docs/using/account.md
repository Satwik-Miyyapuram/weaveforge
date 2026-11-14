---
covers:
  - apps/web/src/features/auth
  - crates/wf-core/src/account_links.rs
  - crates/wf-core/src/account_menu.rs
  - crates/wf-core/src/account_provision.rs
  - crates/wf-core/src/account_purge.rs
checked: 2026-11-14
---
# Your account

WeaveForge keeps your research in one place, and that place needs to know it is
really you. This page walks through the sign-in screen, the emails it sends,
the privacy notice you click through once, and the few corners of the app
where things can go sideways. Nothing here needs a computer science degree,
and if you ever get stuck, the last section has the messages you are most
likely to see and what to do about each.

## Signing in

The sign-in screen offers a few ways in. Pick whichever one suits you.

**Password.** Type your university or lab email into the **Email** box, type
your password into the **Password** box, and press **Sign in**. First time
here? Click **Create an account** underneath, fill in the same two boxes, and
press **Create account**. The screen then says "Check your email" and asks you to
open the confirmation link it sent before you can use the account.

**Google.** Press **Continue with Google**. Your browser leaves for Google,
you pick your account, and you come back to WeaveForge already signed in.

**An emailed code.** Type your email, then press **Email me a sign-in code**.
The screen changes to "Enter your code" and a box called **Email code** appears.
Type the code from your inbox and press **Verify code**. The code is short-lived,
so use it promptly.

**An emailed link.** If codes are not your thing, press **Email me a sign-in
link instead**. Open the email, and you are signed in. The screen says "Check
your email" in the meantime, and a **Back** button takes you out of it.

Every email-based option needs the email box filled in first. The buttons stay
greyed out until it is.

## Working without an account

On the desktop app there is one more choice on the sign-in screen: **Use without
an account, local only**. It keeps everything on your own computer, with no
sign-in, no server and no internet connection needed. The whole story, including
what the app stores and where, lives in [The desktop and mobile apps](desktop.md#working-without-an-account).
For what a local workspace looks like day to day, see [Workspaces](workspaces.md).

When the app is running this way, a small tag reading "Offline · on this
computer" sits in the app's header. Hover over it and it says your data is on
this computer, that nothing is sent anywhere, and that no connection is needed.
If you see that tag, you know you are in local mode.

If the desktop app shows "Couldn’t start the app", that screen also
offers **Work on this computer (offline)**, which switches to the same local mode.

You can sign in later on a local copy. Your local work stays where it is on the
computer; signing in just adds an account and a server alongside it.

## The privacy notice

The first time you open an account on the server, WeaveForge shows a window
called **Privacy & data protection** and stops there until you read it. It does
not let you click past it with a close button, so you do have to press the
button at the bottom.

The window opens with three short points. In plain words, they say that:

- your papers, notes and files are stored on the server, encrypted while they
  sit there, and only you and the people you share with can open them;
- whoever runs the server can technically read what is stored, so keep anything
  truly sensitive out of tags;
- AI features stay off until you switch them on, and deleting your account needs
  a one-time code sent to your email.

A link called "Read the full privacy and data-protection details" opens the long
version if you want the details. When you are happy, press **I understand —
continue**. You will not see the window again on that account.

The notice does not appear on a local copy, because nobody else can read your
data there. Sign-in screens also remind you that signing in means you agree to
the privacy notice shown next.

## Forgot your password?

It happens to everyone. Here is the route back in.

1. On the sign-in screen, type the email on your account into the **Email** box.
   Only then does **Forgot password?** light up. Press it.
2. The screen says "Password reset sent" and reminds you that if an account
   exists for that address, a link to choose a new password is on its way.
   Press **Back** if you want to return to the form.
3. Open the email and click the link. You land on a page titled "Choose a new
   password".
4. Type your new password into **New password**, type it again into **Retype
   new password**, and press **Set new password**. The password needs at least
   8 characters, and both boxes must match.
5. The page says "Password changed". Press **Continue** and you are in.

If the link is old or has already been used, the page says "Reset link
unavailable" and tells you to request a new reset email. Start again from step
1.

## Recovering your account

There used to be a separate recovery page. It is still there, but it no longer
does any recovery of its own. Opening it simply sends you on to your dashboard,
with nothing to fill in. If you cannot get in, use **Forgot password?** above or
ask for a sign-in code or link instead.

## Opening an invite link

When a colleague shares something with you, they can send you a link. Click it
and WeaveForge shows "Opening shared item…" while it checks the link. If the
link is good, the item opens straight away and you can start reading.

If the link was cut short, you see "This link is incomplete" followed by the
advice to ask the sender for the full link. If the link is expired, has been
used up or is otherwise not valid, you see "This link didn't open" with the
reason underneath it. Either way, ask the person who sent it for a fresh link.
The button on that screen, **Go home**, takes you back to the front page.

## Signing out

Your account menu sits in the top bar, behind your account button, and it has
a sign-out entry in it.

If your session runs out while you are working, a box reading "You're signed
out." appears. Press **Sign in to sync** to pick up where you left off. Your
workspace folder stays connected on this computer the whole time.

## Stuck?

**Q: The reset page says "The passwords do not match." What now?**
A: The two password boxes on the reset page must be identical. Retype both and
press **Set new password** again.

**Q: I opened the reset link and it says "Reset link unavailable." Why?**
A: Reset links expire and work only once. Go back to the sign-in screen, type
your email, press **Forgot password?** again, and use the newest email you
receive.

**Q: The sign-in-address box says "That is not the sign-in address." What did I
paste wrong?**
A: That box only appears when another program is using the port the sign-in
browser tab needs. Copy the whole address from the browser tab the sign-in ended
on, including everything after the question mark, and paste that.

**Q: A shared link says "This link didn't open." Is my account broken?**
A: No. The link itself is the problem: it is expired, used up or incomplete.
Ask the sender for a new one, and check that you copied the whole link.
