# The desktop app

WeaveForge in a window of its own. It is the same app the browser runs — the
same notes, the same library, the same account — wrapped so it opens from the
taskbar, keeps its own window size, and does not sit in a tab that gets closed
by accident.

Nothing is stored differently. Sign in on the desktop and the browser sees the
same notes a moment later, because both are talking to the same account.

## Signing in with Google

Pick **Continue with Google** and your normal browser opens on Google's own
sign-in page. Choose the account, and the browser shows a short page saying
you're signed in. The app finishes on its own — go back to it and you are
already through. There is no code to copy and no button to press.

If the browser tab is still open once the app has let you in, close it. It has
nothing left to do.

### Why the browser and not a window inside the app

Signing in inside the app would mean the app could read everything you typed on
Google's page, including your password. Because it *could*, Google will not
allow it — an embedded browser is refused sign-in outright, and every app you
use in this shape does the same thing: it hands the sign-in to a browser you
already trust, and gets back only the result.

The way the result comes back is the part worth knowing about. While it is
waiting, the app listens on `127.0.0.1` — your own machine, on a port nothing
outside it can reach — and the browser is sent there at the end. Nothing about
your sign-in crosses the network to get from the browser to the app, because
both are on the same computer.

### If sign-in doesn't finish

**The browser says it can't reach the page.** The app has to be running and
waiting for the browser to arrive. If it was closed or restarted mid-way,
start the sign-in again from the app.

**Something else is on the port.** WeaveForge listens on port 53682, and only
while a sign-in is in flight. If another program holds it, the app logs
`sign-in listener could not start` on startup and the sign-in has nowhere to
land. Quitting the other program is enough; nothing needs configuring.

**You took too long.** The code the browser brings back is good for about five
minutes and can only be used once. Past that, start again.

## Signing in with an email address

Email and password work the same as they do in the browser, with no round trip
through anything. If you use both, they are the same account only if the
addresses match.

## Updating

Most of WeaveForge does not need updating at all. The window loads the app from
the web, so a change to the app is there the next time you open it — the same
way a browser tab gets it. There is nothing to download and no version of the
app to keep in step.

What the installer holds is the window itself: signing in, links opening in your
browser, and the machinery underneath them. That part changes rarely, and when
it does the app tells you: when it starts, and again whenever you sign in, it
asks GitHub whether a newer release exists — and if one does, it offers you the
release page. Nothing is downloaded until you choose to, and the app does not
install anything behind your back.

Saying no is not remembered. The offer comes back next time, because a window
that is out of step with the server stays out of step until it is replaced, and
signing in is the moment that matters most: it is the part of the app the
installer actually holds.

If the check cannot reach GitHub it says nothing rather than showing you an
error, because a shell that cannot reach GitHub is still a working shell.

## Links

Links to other sites open in your normal browser, not inside the app window.
That is deliberate: the app window is for WeaveForge, and a page that arrived
from somewhere else does not get to run in it.
