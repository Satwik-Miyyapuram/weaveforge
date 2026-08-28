# The Oracle shift — the whole thing, start to finish

> **Who this is for:** you have just created an Oracle Cloud account and have not
> done this kind of thing before. This is the only document you need. It goes
> from empty account to your app reading and writing its own database.
>
> **Time:** 3–5 hours the first time, most of it waiting on Oracle's console.
> You can stop after any stage and come back.

---

## What you are actually building, in plain terms

Right now everything lives at Supabase: your login, your tables, your files.
Supabase is a hosted product, and hosted products have a free tier that
eventually stops being free.

You are moving **the tables** onto a virtual machine you control at Oracle,
which is free forever under their Always Free tier. Two things deliberately do
**not** move:

- **Login stays at Supabase.** Users keep signing in exactly as they do today.
  Auth is the hardest part to move and the least valuable to own, so it stays.
- **Your app keeps running on Vercel.** Nothing about the front end changes.

The result:

```
  Browser
    │
    ├──► Supabase Auth ......... sign in (unchanged, forever)
    │
    └──► Your Oracle VM ........ every table read and write (this is the move)
           ├─ Postgres :5432 ... the database itself
           ├─ PostgREST :3000 .. turns HTTP requests into SQL, so the
           │                     browser can talk to Postgres at all
           └─ MinIO :9000 ...... file storage (optional, later)
```

**Why PostgREST?** A browser cannot open a database connection — that is not a
thing browsers can do. Supabase solved this by putting a program called
PostgREST in front of their Postgres, which accepts HTTPS and speaks SQL on the
other side. Your app already speaks that protocol, on every page. So you run
your own copy of the same program, and the app cannot tell the difference. This
is the single reason the cutover ends up being one environment variable instead
of a rewrite.

### The four stages

| Stage | What happens | Reversible? | Time |
|---|---|---|---|
| **0. Prerequisites** | Collect four secrets from Supabase. Nothing to install | yes | 10 min |
| **1. Build the box** | Create the VM, disks, firewall, containers | yes — delete it | 2–4 h |
| **2. Copy the data** | Supabase → Oracle. Read-only from Supabase | yes — it only reads | 15 min |
| **3. Cut over** | Point the app at Oracle. One variable | yes — remove the variable | 30 min |

**Stages 0–2 cannot break your live app.** The migration never writes to
Supabase and never deletes anything. Until stage 3, the Oracle box is just a
copy sitting there. That is the whole reason it is built in this order — take
your time, and do not let anyone rush you into stage 3.

Pick an OCI **region** close to you, and to your R2 bucket if you use one.

---

# Stage 0 — Prerequisites

## 0.1 Nothing to install

Node and git are all the migration needs. Check:

```bash
node --version && git --version && ssh -V
```

**You do not need `psql`.** Every step here speaks to Postgres through the `pg`
driver, which is already a dependency of the app. That is deliberate: `psql`
ships only in EnterpriseDB's Windows installer, which wants admin rights and
whose download server returns `403 Forbidden` often enough to be a real
obstacle. If you have `psql` anyway, nothing here objects — it is simply not
used.

## 0.2 Collect four things from Supabase

Open [the Supabase dashboard](https://supabase.com/dashboard) and write these
down somewhere private. You need all four; hunting for them mid-migration is
how people make mistakes.

| What | Where in the dashboard |
|---|---|
| **Database URI** | Project Settings → Database → Connection string → **URI** |
| **Project URL** | Project Settings → API → Project URL |
| **anon key** | Project Settings → API → `anon` `public` |
| **JWT Secret** | Project Settings → API → JWT Settings → **JWT Secret** |

⚠️ **On the Database URI:** the dropdown offers three that look nearly
identical. Port and username are what distinguish them.

| | Port | Username | Use it? |
|---|---|---|---|
| Direct | 5432 | `postgres` | Only if you have IPv6 — see below |
| Session pooler | 5432 | `postgres.<projectref>` | **Yes** — the safe default |
| Transaction pooler | 6543 | `postgres.<projectref>` | **No** |

The *transaction* pooler drops the cursors the migration holds across
statements, and fails halfway through with something that does not mention
pooling.

⚠️ **The direct host is IPv6-only on current projects.** It publishes an `AAAA`
record and no `A`, so on a network without IPv6 you get:

```
getaddrinfo ENOTFOUND db.<projectref>.supabase.co
```

which reads like a typo and is not one. Check before assuming:

```bash
nslookup db.<projectref>.supabase.co
```

Only `AAAA` back means direct will not work from your machine. Use the session
pooler — it is IPv4 and equally correct for this migration.

⚠️ **The JWT Secret is the one people forget.** It is what lets your PostgREST
trust the login tokens Supabase issues. Without it, every request to your new
database comes back `401` and nothing works. It is on the API page, not the
Database page.

## 0.3 Never commit any of this

Everything credential-shaped goes in **`secrets/`**, which `.gitignore` excludes
whole — `.env.migration`, `.env.oci`, and any key a cloud console downloads.
See [`secrets/README.md`](../../secrets/README.md). Verify before writing
anything into it:

```bash
git check-ignore -v secrets/.env.migration
```

If that prints nothing, the file is **not** ignored — stop and add `/secrets/`
to `.gitignore` first.

⚠️ **Watch where your browser saves cloud-console downloads.** OCI hands you an
API key and an SSH key as files, and browsers save to whatever directory was
used last — which is how both ended up in this repository's root during the
original run. They were caught before the commit, but a key pushed to a public
repo is a full account compromise, and deleting it in a later commit does not
remove it from history: the only fix is rotation.

`.gitignore` therefore keeps `*.pem`, `*.key` and `.env*` patterns *as well as*
the `/secrets/` rule. One directory rule is a single careless edit from being
wrong.

Two things cannot move into `secrets/`, because their tools only look in one
place: `apps/web/.env.local` (Next.js) and `~/.oci/` (the OCI CLI). Those are
outside the repo or already ignored where they are.

## 0.4 Make an SSH key

```bash
ssh-keygen -t ed25519 -f ~/.ssh/oci_weaveforge -C "weaveforge-oci"
```

⚠️ **In PowerShell, use `$HOME` instead of `~`.** PowerShell passes `~` through
to native programs literally rather than expanding it, and `ssh-keygen` fails
with `Saving key "~/.ssh/oci_weaveforge" failed: No such file or directory`.
The `.ssh` directory may not exist yet either:

```powershell
New-Item -ItemType Directory -Force "$HOME\.ssh" | Out-Null
ssh-keygen -t ed25519 -f "$HOME\.ssh\oci_weaveforge" -C "weaveforge-oci"
```

Git Bash expands `~` normally, so the first form works there. Every `~/.ssh/…`
path below has the same split.

**Set a passphrase.** Without one the private key sits in `~/.ssh` as plaintext,
readable by anything running as you — a malicious postinstall script, a synced
backup, a stolen laptop. With one it is an encrypted blob. It protects the file,
not the connection.

An agent will hold it, so you type it once per session instead of per
connection. Optional — this setup involves a dozen or so logins, and typing the
passphrase each time is a fine answer.

**In Git Bash** — no admin needed, lasts for that window:

```bash
eval "$(ssh-agent -s)" && ssh-add ~/.ssh/oci_weaveforge
```

**In PowerShell** — `eval` does not exist there, and the ssh-agent service ships
*disabled*, so enabling it needs elevation once. From an **Administrator**
PowerShell:

```powershell
Set-Service ssh-agent -StartupType Automatic; Start-Service ssh-agent
```

Then from your **normal** PowerShell — adding the key as Administrator would
load it into the wrong user's agent:

```powershell
ssh-add $HOME\.ssh\oci_weaveforge
```

Without the elevated step, `Start-Service` fails with `error :1058`, which means
the service is disabled rather than missing.

Git Bash ships its own OpenSSH and does not always use the Windows agent, so a
key added in PowerShell may still prompt in Git Bash. Use one or the other
consistently.

Adding a passphrase later needs no new key — it encrypts the private half only,
so the public key already installed on the server keeps working:

```bash
ssh-keygen -p -f ~/.ssh/oci_weaveforge
```

You paste the contents of the **`.pub`** file — the public half — into the
Oracle console. The half without `.pub` never leaves your machine.

---

# Stage 1 — Build the box

Everything in this stage happens in the [OCI Console](https://cloud.oracle.com/)
and over SSH.

## 1.1 A compartment

Optional but keeps things tidy, and makes cleanup one click if you start over.

1. **Identity & Security** → **Compartments**
2. **Create compartment** → name it `weaveforge`

Use it for everything below.

## 1.2 A network

1. **Networking** → **Virtual cloud networks** → **Start VCN Wizard**
2. Choose **Create VCN with Internet Connectivity**
3. Name `weaveforge-vcn`, CIDR `10.0.0.0/16` → **Next** → **Create**

Note the **public subnet** it makes (e.g. `10.0.0.0/24`) — the VM goes there.

⚠️ **Use the wizard, not the plain "Create VCN" button.** Plain creates the
network with no internet gateway and an empty route table. Everything then
appears to work — the VM launches, gets a public IP, the security list accepts
your rules — and every connection to it times out, because there is no route
off the network. It looks identical to a firewall problem and is not one.

Confirm before you go further; both should return something:

```bash
oci network internet-gateway list --compartment-id <compartment> --vcn-id <vcn>
oci network route-table list --compartment-id <compartment> --vcn-id <vcn> \
  --query 'data[].{name:"display-name",rules:length("route-rules")}' --output table
```

A gateway must exist and the route table must have at least **one** rule. If
`rules` is 0, that is the fault. Fix without rebuilding:

```bash
# 1. Create the gateway
oci network internet-gateway create --compartment-id <compartment> --vcn-id <vcn> \
  --is-enabled true --display-name weaveforge-igw --wait-for-state AVAILABLE

# 2. Route everything to it — save as rt.json
#    [{"destination":"0.0.0.0/0","destinationType":"CIDR_BLOCK","networkEntityId":"<igw-ocid>"}]
oci network route-table update --rt-id <route-table> --route-rules file://rt.json --force
```

In the console it is the same two steps: **Internet Gateways → Create**, then
**Route Tables → the default one → Add Route Rule**, destination `0.0.0.0/0`,
target type Internet Gateway.

## 1.3 The firewall, part one: the security list

Open the VCN → **Security Lists** → the default one.

⚠️ **Check the egress rules before the ingress ones.** A wizard-built VCN gets an
allow-all egress rule; a plain one gets an empty list, and then nothing on the
VM can reach the internet — `apt`, the Docker install script, image pulls all
hang. It looks like a broken VM and is not one. There should be one rule,
destination `0.0.0.0/0`, protocol *All*. If the list is empty:

```bash
# [{"destination":"0.0.0.0/0","destinationType":"CIDR_BLOCK","protocol":"all","isStateless":false}]
oci network security-list update --security-list-id <sl> --egress-security-rules file://egress.json --force
```

Now **Add Ingress Rules**.

Security lists match on **CIDR only** — no hostnames, so there is no
dynamic-DNS trick for a home IP that moves. Either you edit the rule each time
it changes, which people stop doing after a week, or you open the port and put
the security somewhere that does not depend on your address. The table below
takes the second path. Read 1.3.1 before you leave it that way.

Each rule needs exactly these fields:

| Stateless | Source Type | Source CIDR | IP Protocol | Source Port Range | **Destination Port Range** | Description |
|---|---|---|---|---|---|---|
| off | CIDR | `0.0.0.0/0` | TCP | *(leave empty)* | `22` | SSH |
| off | CIDR | `0.0.0.0/0` | TCP | *(leave empty)* | `5432` | Postgres |
| off | CIDR | `0.0.0.0/0` | TCP | *(leave empty)* | `3000` | PostgREST |
| off | CIDR | `0.0.0.0/0` | TCP | *(leave empty)* | `9000` | MinIO API — only if you want blobs |
| off | CIDR | `0.0.0.0/0` | TCP | *(leave empty)* | `9001` | MinIO console — see 1.3.1 |

⚠️ **Leave Source Port Range empty.** It is the *client's* ephemeral port, which
is random per connection — putting the service port there blocks everything.
The port you mean goes in **Destination Port Range**. The form is easy to fill
in the wrong order, and a rule with both boxes empty reads "allows TCP traffic
for ports: all", which is the tell that you have not set the destination yet.

**Leave Stateless off.** Stateful means the reply traffic is allowed back
automatically. Stateless would need a matching egress rule for every one of
these, and the failure mode is silent one-way traffic.

⚠️ **Port 3000 is the easy one to skip**, because nothing needs it until the
very last stage. Skip it and stages 1 and 2 both pass perfectly, then the
cutover fails with a timeout that reads like a DNS fault.

### 1.3.1 What opening these actually costs

`0.0.0.0/0` is a reasonable trade for 22 and 3000 and a bad one for 9001. They
are not equivalent, so they are worth separating:

**Port 22 — fine.** Key-only authentication is genuinely strong, and Oracle's
Ubuntu images ship with password login disabled. Bots will knock constantly and
get nowhere. Leave it open.

**Port 3000 — fine once it has TLS.** PostgREST applies row-level security to
every request and rejects anything without a valid token. Until you put a
certificate in front of it (3.4), the tokens themselves cross the internet in
clear text — acceptable while you are the only user, not after.

**Port 5432 — narrow it when you are done.** Only the password stands between
the internet and your database, and this port is scanned continuously. Use 32+
random characters. You only need it reachable from your laptop during stage 2,
so once `Safe to cut over` has printed, edit this rule down to `YOUR_IP/32` —
the app itself reaches Postgres through PostgREST on the VM, not over 5432.

**Port 9001 — do not leave this open.** It is the MinIO console: a login page,
over plain HTTP, guarded by `MINIO_ROOT_PASSWORD` alone, and that password is
root access to all your object storage. If you only need it to create a bucket,
create the bucket and then **delete the rule** — nothing else uses the console.

**Simplest option: skip 9000 and 9001 entirely for now.** Blobs are optional and
come after the database move. Two fewer open ports while you are learning the
rest.

Once things work, [1.3.2](#132-tightening-later) is the version to run long-term.

### 1.3.2 Tightening later

When the box stops being a scratch environment:

- **5432** → `YOUR_IP/32`, or drop it entirely and use `ssh -L` port forwarding
  when you need a direct connection.
- **9001** → deleted, recreated only when you need the console.
- **3000** → behind Caddy on 443 with a certificate (3.4); the raw port can then
  be closed.
- **22** → stays open; the key is the control.

**Or skip the whole list.** A Cloudflare Tunnel takes the VM off the public
internet entirely — no ingress rules at all — and hands you a free TLS
certificate on the way, which also settles 3.4. It is free apart from needing a
domain. Written up in [1.11](#111-optional--cloudflare-tunnel-instead-of-open-ports);
do the migration on plain ports first.

## 1.4 ⚠️ The firewall, part two: the one inside the VM

This is the single most common way to lose an afternoon. **Oracle's Ubuntu
images ship with local iptables rules that reject everything except port 22**,
independently of the security list you just wrote. The ports have to be opened
in both places.

You cannot do this yet — it needs an SSH session. Come back to it after 1.6.

The chain ends in a catch-all `REJECT`, so a new rule only counts if it goes
**above** that line. Find where it is rather than assuming:

```bash
for p in 5432 3000; do
  pos=$(sudo iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')
  sudo iptables -I INPUT "$pos" -m state --state NEW -p tcp --dport "$p" -j ACCEPT
done
sudo netfilter-persistent save
```

Add `9000 9001` only if you are setting up MinIO. Port 22 is already open — the
one rule Oracle's image ships with.

⚠️ **`-I INPUT 6` is wrong on Ubuntu 24.04**, and this guide used to say it. The
chain is five rules long there, so position 6 lands *after* the `REJECT` and the
rule never matches. Nothing complains: `iptables -S` lists your rule,
`netfilter-persistent save` succeeds, and the port stays shut. Verify the order
instead of trusting the command:

```bash
sudo iptables -L INPUT --line-numbers -n
```

Every `dpt:` line must have a **lower number** than the `REJECT` line.

Without that final `save`, the rules vanish on the next reboot and everything
breaks weeks later for no visible reason. On a *Minimal* image
`netfilter-persistent` does not exist until you install `iptables-persistent`
(see 1.5).

**How this failure looks, versus the other two.** This chain uses `REJECT
--reject-with icmp-host-prohibited`, which answers immediately. The OCI security
list and a missing route drop packets silently instead. So the timing tells you
where to look:

| Symptom | Cause |
|---|---|
| Hangs ~30s, then times out | No route to the internet (1.2), or the security list (1.3) — packets never arrived |
| Refused, immediately | This chain, or nothing listening on that port |

## 1.5 The virtual machine

1. **Compute** → **Instances** → **Create instance**
2. **Name:** `weaveforge`
3. **Placement:** your compartment, an availability domain with **Ampere**
   capacity. Some regions have only one — `eu-amsterdam-1` is single-AD, so
   there is no second domain to fall back on, and moving region is not the
   answer either — see the capacity note below
4. **Capacity type:** **On-demand**. The other three all cost money, and
   *preemptible* means Oracle reclaims the machine at any time — fine for a
   batch job, fatal for a database
5. **Image:** must be **aarch64** — the plain images are x86_64 and will not
   boot on this shape. See the note below about *Minimal*
6. **Shape:** shape series **Ampere**, then `VM.Standard.A1.Flex` — it is
   labelled *Always Free-eligible*. The form opens on AMD, which is **not**
   free. Expand the `▸` to reach the OCPU and memory sliders: they default to
   **1 OCPU / 6 GB**, and the free allowance is **2 OCPUs / 12 GB** total
   across all your A1 instances. Building one machine, take both

   ⚠️ **Not 4 OCPUs / 24 GB.** That was the allowance until **15 June 2026**,
   when Oracle halved it (3,000 → 1,500 OCPU-hours, 18,000 → 9,000 GB-hours
   per month) with no announcement — just a documentation edit. Most guides
   and blog posts still say 4/24. Setting that today bills you for the
   overage.
7. **Networking:** `weaveforge-vcn`, and tick **Assign public IPv4**
8. **SSH keys:** paste the contents of `~/.ssh/oci_weaveforge.pub`
9. **Boot volume:** the 50 GB default is fine. It **counts toward** the 200 GB
   free storage allowance, so see the budget in 1.7 before enlarging it
10. **Create**

**Prefer the plain image over *Minimal*.** `Canonical-Ubuntu-24.04-aarch64`
exists even though the console's image list does not always surface it — expand
the image family, or let the retry script pick it, which it does by default.

Minimal is stripped of packages this guide assumes: `nano` (1.9) and
`iptables-persistent`, which is what provides `netfilter-persistent` (1.4).
Without the latter, `netfilter-persistent save` fails with `command not found`
and your firewall rules disappear on the next reboot — the delayed failure 1.4
warns about. Minimal is a perfectly good Docker host otherwise; it just needs
this first, after your first SSH:

```bash
sudo apt-get update && sudo apt-get install -y nano iptables-persistent
```

### ⚠️ `Out of host capacity` — expect this

> Out of capacity for shape VM.Standard.A1.Flex in availability domain AD-1.

Ampere demand, not a mistake on your part. It is the single most common thing
to hit here, and in popular EU regions it can take days.

**Ignore the part of the message suggesting another region.** Always Free
**block volumes must be in your home region** — created anywhere else they bill
at normal rates, so a VM in another region would come with a disk that costs
money. Some regions are also single-AD (`eu-amsterdam-1` among them), so there
is no second availability domain to move to either.

What actually helps, in order:

1. **Ask for less.** Step down 2/12 → 1/6. The whole shape has to fit on one
   host, so a smaller request fits more gaps. One OCPU and 6 GB runs Postgres,
   PostgREST and MinIO perfectly well for one person, and the shape can be
   resized up later without rebuilding the machine.
2. **Clear the fault domain** if you set one under Advanced options. It
   constrains placement to a third of the AD and buys you nothing here.
3. **Retry, repeatedly, off-peak.** Capacity frees as other people release
   instances.
4. **Let a script do the retrying** —
   [`scripts/oci-launch-retry.sh`](../../scripts/oci-launch-retry.sh). Set it
   going and go to bed. Details below.
5. **Upgrade to Pay As You Go** — needs a card. The last resort, written up
   below.

Nothing downstream is blocked while you wait: the migration scripts, schema and
`secrets/.env.migration` can all be prepared without a VM.

#### Retrying automatically

[`scripts/oci-launch-retry.sh`](../../scripts/oci-launch-retry.sh) asks on a
schedule, walks *down* the shape ladder each round so a 1/6 slot is taken the
moment one appears, and stops the instant it gets a machine — printing the
public IP and the `ssh` line to use.

It deliberately **aborts** rather than retries on `NotAuthenticated`,
`LimitExceeded`, `InvalidParameter` and friends. A plain
`until oci … ; do sleep 60; done` cannot tell "no capacity right now" from "your
subnet OCID has a typo", so a malformed request retries in silence until
morning. Those errors are printed and the script stops.

**Where to run it.** Your own machine. Cloud Shell has the CLI pre-authenticated
and is tempting, but it disconnects on idle and reclaims the session, so it will
not survive a night.

**One-time CLI setup.** The OCI CLI is a Python program; `uv` installs it into
its own environment rather than into whatever Python you happen to be using —
which matters if that Python is a conda base you would rather not disturb:

```bash
uv tool install oci-cli
```

*(Oracle's own `install.ps1` works too. `pip install oci-cli` also works but
puts a large dependency tree into the active environment.)*

Then authenticate:

```bash
oci setup config
```

It asks for your user OCID, tenancy OCID and region — the first two are under
the profile menu and the **Tenancy** page in the console — and generates an API
key. Upload the public half at **Profile → My profile → API keys**. Confirm:

```bash
oci iam region list
```

The retry script checks this first and tells you to run `oci setup config` if
it is missing, rather than failing later with a confusing message about a
compartment it could not find.

**Then run it.** There are two twins — use whichever shell you are in. Git Bash
is not on PATH in a default PowerShell session, so the `.sh` will not run there:

```powershell
./scripts/oci-launch-retry.ps1
```

```bash
cp scripts/.env.oci.example secrets/.env.oci   # optional; it auto-discovers otherwise
./scripts/oci-launch-retry.sh
```

Both discover the compartment, availability domain, subnet and image
themselves, and print what they resolved before starting — check the image line
says `24.04-aarch64` before walking away.

`-MaxHours 0` (or `MAX_HOURS=0`) resolves everything and then exits without
launching, which is a safe way to confirm the discovery is right.

Both also refuse to build a second machine. A launch can succeed on Oracle's
side while the connection times out on yours — `RequestException: The
connection to endpoint timed out` says nothing about whether the VM was
created — so they check for an existing instance before every attempt, and
again after any timeout. Retrying blindly through one of those is how you end
up with two instances and a bill.

#### If capacity never comes: Pay As You Go

The fallback when retrying has genuinely not worked. It usually helps — PAYG
tenancies get launch priority — but it is not a guarantee; people do sit on
`Out of host capacity` with PAYG accounts too.

**Always Free resources stay free after upgrading.** Oracle bills only usage
*above* the free limits. What changes is that the guardrails come off: a Free
Tier account cannot overspend, a PAYG account can, and **there is no spending
cap**. Budget alerts notify you; they do not stop anything.

1. Console → **Billing & Cost Management** → **Upgrade and Payment Method**
2. **Upgrade to Pay As You Go**, add a card — a small verification charge
   reverses itself
3. **Then set a budget before creating anything else.** Billing & Cost
   Management → **Budgets** → Create Budget, scoped to your compartment,
   amount £1, alert at 100% of *actual* spend. Anything above zero means you
   have left the free tier, and you want to hear about it that day rather than
   at month end

Stay inside these and the bill stays zero:

| | |
|---|---|
| Ampere A1 | 2 OCPU / 12 GB total |
| Block storage | 200 GB total, boot volumes included |
| Outbound transfer | 10 TB / month |

The VM is not the risk — incidental resources are. A second instance, a spare
volume, a load balancer created while experimenting: all billable now, none of
them refused.

*(Reports that PAYG accounts kept the pre-June 4 OCPU / 24 GB allowance have not
held up — plan on 2/12 regardless.)*

It writes every response to `oci-launch-retry.log`, both gitignored. Defaults to
90-second intervals and gives up after 12 hours; `INTERVAL` and `MAX_HOURS`
override.

If the CLI setup is more than you want at this hour, clicking **Create** again
every so often costs nothing and works just as well — the script only saves you
the clicking.

**The estimated cost panel will show a figure — around $2.76/month for the boot
volume.** It prices everything at list rate and applies no Always Free
allowance at all, which is why compute is absent from it despite being the
expensive part. It is not a warning; it is what this would cost without the
free tier. Stay inside the limits below and the bill is zero.

Wait for state **Running**, then copy the **Public IP** (e.g. `129.12.34.56`).
Everything below refers to it as `YOUR_PUBLIC_IP`.

## 1.6 Get in

```bash
ssh -i ~/.ssh/oci_weaveforge ubuntu@YOUR_PUBLIC_IP
```

Ubuntu images use the user `ubuntu`; Oracle Linux uses `opc`.

On a *Minimal* image, first:

```bash
sudo apt-get update && sudo apt-get install -y nano iptables-persistent
```

**Then go back and run 1.4** — the firewall inside the VM.

## 1.7 Disks

Separate block volumes, so the data survives rebuilding the VM.

⚠️ **Budget the 200 GB first.** Always Free gives **200 GB of block storage in
total**, and **the boot volume counts toward it**. Five volume backups are
included too, and those need room.

| | | |
|---|---|---|
| Boot volume | 50 GB | already created with the instance |
| `weaveforge-pgdata` | 50 GB | **create this one now** |
| `weaveforge-minio` | 100 GB | only when you actually want blobs |
| | **200 GB** | exactly the limit, with nothing spare |

Create **only `weaveforge-pgdata`** for now. MinIO is optional and comes after
the database move, and allocating its 100 GB up front puts you on the ceiling
for storage you are not using yet. Minimum boot volume is 47 GB if you ever
need to claw back a few.

**Storage** → **Block volumes** → **Create**:

| Name | Size |
|---|---|
| `weaveforge-pgdata` | 50 GB |

For each: **Attach instance** → `weaveforge` → **Paravirtualized**.

### ⚠️ Formatting erases a disk, silently and instantly

On the VM:

```bash
lsblk
```

Read the output before typing anything else.

**Size will not tell them apart** — the boot volume and `weaveforge-pgdata` are
both 50 GB. Go by structure instead:

- The **boot disk has partitions nested under it** (`sda1`, `sda15`, …) and one
  of them is mounted at `/`. Formatting it destroys the VM.
- The **new volume has no partitions and no mountpoint** — a single bare line.

```
sda      50G            ← boot: has children below, one mounted on /
├─sda1   49.9G  /
├─sda14    4M
└─sda15  106M  /boot/efi
sdb      50G            ← the new volume: bare, no mountpoint
```

If your output does not look that unambiguous, stop and ask rather than
guessing. This is the one step in the guide with no undo.

Then, substituting your actual device name:

```bash
sudo mkfs.ext4 /dev/sdb
sudo mkdir -p /mnt/pgdata
sudo mount /dev/sdb /mnt/pgdata
```

*(Add `/mnt/minio` on its own volume later, if and when you set up blobs.)*

Make the mounts survive a reboot. `blkid` prints each disk's UUID:

```bash
sudo blkid
echo 'UUID=YOUR-PG-UUID  /mnt/pgdata  ext4  defaults,nofail  0  2' | sudo tee -a /etc/fstab

sudo chown -R ubuntu:ubuntu /mnt/pgdata
```

`nofail` matters: without it, a disk that fails to mount stops the VM booting
at all, and you would need the console to recover it.

## 1.8 Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit
```

Log back in — group changes only apply to a new session — and check:

```bash
docker ps
```

## 1.9 The services

From your laptop, in a second terminal (not the SSH session), send the two
config files up:

```bash
scp -i ~/.ssh/oci_weaveforge infra/oci/docker-compose.yml infra/oci/.env.example ubuntu@YOUR_PUBLIC_IP:~/
```

Back in the SSH session:

```bash
mkdir -p ~/weaveforge-infra && mv ~/docker-compose.yml ~/.env.example ~/weaveforge-infra/
cd ~/weaveforge-infra && cp .env.example .env && nano .env
```

Fill in four values:

```ini
POSTGRES_PASSWORD=<long random string, letters and digits only>
SUPABASE_JWT_SECRET=<the JWT Secret from step 0.2>
MINIO_ROOT_PASSWORD=<long random string>
CORS_ALLOWED_ORIGINS=*
```

⚠️ **`SUPABASE_JWT_SECRET` is required** — `docker-compose.yml` refuses to start
without it, which is what the `:?` in `${SUPABASE_JWT_SECRET:?…}` means. It is
what lets PostgREST trust the tokens Supabase Auth issues.

⚠️ **Avoid `@`, `:`, `/`, and `#` in the Postgres password.** Those characters
have meaning inside a connection URL and would need percent-encoding — a
tedious and easily-botched extra step. Letters and digits, 32+ characters.

`CORS_ALLOWED_ORIGINS=*` is fine while you are the only user. Change it to your
real origin before anyone else touches the box — for this project that is
`https://app.weaveforge.org`, the host the app is served from. A browser cannot
tell a refused origin from an unreachable server: both arrive as
`TypeError: Failed to fetch`, so an origin missing from this list looks exactly
like the API being down.

*In `nano`: type, then `Ctrl+O`, `Enter` to save, `Ctrl+X` to exit.*

Start the two you need:

```bash
docker compose up -d postgres postgrest
docker compose ps
```

| Container | Port | Data |
|---|---|---|
| `weaveforge-postgres` | 5432 | `/mnt/pgdata` |
| `weaveforge-postgrest` | 3000 | — |
| `weaveforge-minio` | 9000 API, 9001 console | `/mnt/minio` |

⚠️ **Do not run a bare `docker compose up -d` yet** if you skipped the MinIO
volume in 1.7. Docker does not error on a missing bind-mount path — it creates
the directory, so MinIO would quietly store objects on the **boot volume**
instead of its own disk, filling the 50 GB the OS lives on. Add `minio` to that
command only once `/mnt/minio` is a real mounted volume.

If PostgREST restarts in a loop, `docker compose logs postgrest` — nearly
always a wrong or missing `SUPABASE_JWT_SECRET`.

## 1.10 ✅ Checkpoint — prove you can reach it

This is the one that matters.

⚠️ **Connect through an SSH tunnel, not to the public IP.** The stock `postgres`
image ships without a certificate, so a direct connection to `YOUR_PUBLIC_IP:5432`
either fails with *"The server does not support SSL connections"* or, if you
reach for `?sslmode=disable`, sends your database password across the open
internet in clear text on a port every scanner knocks at. A tunnel costs one
command and removes the problem entirely.

Leave this running in its own terminal:

```bash
ssh -i ~/.ssh/oci_weaveforge -N -L 15432:localhost:5432 ubuntu@YOUR_PUBLIC_IP
```

Then, in the repo — note the password never has to be typed or pasted anywhere,
since it only exists in the VM's `.env`:

```bash
PW=$(ssh -i ~/.ssh/oci_weaveforge ubuntu@YOUR_PUBLIC_IP "grep '^POSTGRES_PASSWORD=' ~/weaveforge-infra/.env | cut -d= -f2")
DATABASE_URL="postgres://weaveforge:$PW@localhost:15432/weaveforge" npm run migrate:ping
```

`✓ Reached it` means the route table, the security list, the VM's own iptables,
and the container are all correct. It will also say there are no tables yet —
expected; the schema comes next, through the same tunnel.

**Do not move to stage 2 until this passes.** Every failure past this point is
harder to diagnose, because more things sit in the path.

It names the likely cause on failure: a hang is the route table (1.2) or
security list (1.3), a quick refusal is the VM's iptables (1.4) or a stopped
container, and *password authentication failed* is a mismatch with the VM's
`.env`.

Use the same tunnelled `DATABASE_URL` for `migrate:schema` and everything in
stage 2. Once the migration is done you can narrow 5432 to your own IP, or drop
the ingress rule altogether and rely on the tunnel — the app itself never uses
5432, only PostgREST on 3000.

## 1.11 Optional — Cloudflare Tunnel instead of open ports

**Skip this on a first pass.** Get the migration working over plain ports
first; this is worth doing once, afterwards, when the box stops being
disposable. It is written to be done later without redoing anything.

### What it actually gives you

A tunnel runs an agent on the VM that dials *out* to Cloudflare and holds the
connection open. Traffic then arrives through that outbound connection instead
of through an open inbound port — so **every ingress rule from 1.3 can be
deleted**, and the VM stops being reachable from the internet at all. Port
scans find nothing, because there is nothing listening.

It also solves [3.4](#34--get-a-certificate-before-anyone-else-uses-it) for
free: a public hostname gets a Cloudflare certificate automatically, so
`NEXT_PUBLIC_DATA_URL` becomes a real `https://` with no Caddy and no renewal
to forget. That is the part that makes this worth the afternoon.

### Is it free?

Yes, with one catch worth knowing before you start.

| | |
|---|---|
| `cloudflared` and the tunnel | Free, no bandwidth limit |
| Cloudflare Zero Trust (for Access policies) | Free up to 50 users |
| TLS certificate for your hostname | Free |
| **A domain in your Cloudflare account** | **~£10/year — this is the catch** |

Public hostnames need a zone in your account, so you need a domain and its DNS
on Cloudflare. If you already have one, add a subdomain and you are done. If
not, that is the only real cost here.

*(There is a free `trycloudflare.com` quick tunnel with a random URL and no
domain needed. It is fine for a five-minute demo — the URL changes on every
restart, so it is not something to point an app at.)*

### The split that matters: HTTP vs raw TCP

Not everything tunnels the same way, and this is the part people hit sideways:

| Service | How it goes through | Client needs anything? |
|---|---|---|
| PostgREST (3000) | Public hostname — ordinary HTTPS | No — any browser |
| MinIO (9000/9001) | Public hostname | No |
| **Postgres (5432)** | **Raw TCP** | **Yes — `cloudflared` on your laptop** |
| SSH (22) | Raw TCP | Yes — or just leave 22 open |

**HTTP services are the easy, complete win.** PostgREST is what the browser
talks to, it speaks HTTPS, and a public hostname handles it entirely.

**Postgres is not HTTP**, so there is no public hostname for it. You run
`cloudflared` locally, which opens a port on *your* machine and forwards it
through the tunnel. That works fine and is genuinely more secure — but it is a
process you have to remember to start before `npm run migrate`. This is why the
guide does not lead with tunnels: it adds a moving part to the one stage where
you most want fewer of them.

### Setting it up

On the VM:

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
sudo mv cloudflared /usr/local/bin/ && sudo chmod +x /usr/local/bin/cloudflared
cloudflared tunnel login          # opens a URL — authorise your domain
cloudflared tunnel create weaveforge
```

Note the tunnel UUID it prints. Then `~/.cloudflared/config.yml`:

```yaml
tunnel: YOUR-TUNNEL-UUID
credentials-file: /home/ubuntu/.cloudflared/YOUR-TUNNEL-UUID.json

ingress:
  # The data API. This is the one that matters.
  - hostname: api.yourdomain.com
    service: http://localhost:3000

  # Postgres, reachable only to someone running cloudflared with access.
  - hostname: db.yourdomain.com
    service: tcp://localhost:5432

  # Required final rule — anything unmatched is refused.
  - service: http_status:404
```

Point DNS at it and run it as a service:

```bash
cloudflared tunnel route dns weaveforge api.yourdomain.com
cloudflared tunnel route dns weaveforge db.yourdomain.com
sudo cloudflared service install
sudo systemctl start cloudflared && sudo systemctl status cloudflared
```

`https://api.yourdomain.com` should now answer, with a valid certificate,
while nothing inbound is open.

On your laptop, for Postgres — [install
`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/),
then leave this running in its own terminal:

```bash
cloudflared access tcp --hostname db.yourdomain.com --url localhost:5432
```

`secrets/.env.migration` then points at your own machine, because that is where the
tunnel surfaces:

```ini
DATABASE_URL=postgresql://weaveforge:PASSWORD@localhost:5432/weaveforge
```

And in Vercel:

```ini
NEXT_PUBLIC_DATA_URL=https://api.yourdomain.com
```

### Then close everything

Once `npm run migrate:ping` works through the tunnel, delete **all** the ingress
rules from 1.3. Keep 22 open until you are confident, then tunnel that too. The
iptables rules from 1.4 can stay — they are harmless with nothing routed to
them, and they save you rediscovering that step if you ever revert.

### Two limits worth knowing up front

⚠️ **100 MB per request on the free plan.** Anything larger through a proxied
hostname is rejected with `413`. Irrelevant for PostgREST — table rows are
nowhere near that — but it caps single-file uploads if you route MinIO through
the tunnel. Large blobs want R2 directly rather than through the proxy.

⚠️ **Lock down the MinIO console rather than just hiding it.** A tunnel makes
`9001` unreachable from the outside, which is already better than 1.3. If you
publish it as a hostname, put a Cloudflare Access policy in front — free tier,
and it means an email login rather than one shared root password guarding all
your object storage.

---

# Stage 2 — Copy the data

Already built and tested. You are running it, not writing it. It reads from
Supabase and never writes to it, so a failed attempt costs time and nothing
else, and the app keeps serving from Supabase throughout.

## 2.1 Write `secrets/.env.migration`

Everything credential-shaped lives in `secrets/`, which is git-ignored whole.
Create the file there, using the values from 0.2:

```ini
# Source. Read-only, never written to.
# Session pooler or direct connection; NOT the transaction pooler.
SOURCE_DATABASE_URL=postgresql://postgres.abcdef:PASSWORD@aws-0-eu-west-2.pooler.supabase.com:5432/postgres

# Target. Your Oracle box.
DATABASE_URL=postgresql://weaveforge:PASSWORD@YOUR_PUBLIC_IP:5432/weaveforge

# Auth stays at Supabase permanently.
NEXT_PUBLIC_SUPABASE_URL=https://abcdef.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Only needed for images and artifacts — see "Files", below.
SUPABASE_SERVICE_ROLE_KEY=eyJ...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=weaveforge-hot
```

Every `migrate:*` command reads this file itself — no `source` step, and it
behaves the same in PowerShell, cmd, and Git Bash. A variable set explicitly on
the command line still wins over the file.

## 2.2 Run it

```bash
npm run migrate
```

That is preflight, schema, copy, verify. It stops at the first problem and says
what to do about it, so after fixing whatever it named, run it again.

⚠️ **One exception to "safe to repeat": `migrate:schema` on a database that
already holds data.** The DDL is re-runnable, but several base migrations also
seed or backfill rows, and replaying those duplicates them. Worse, a migration
written against the schema of its day can contradict today's rows — `0062` adds
a `profiles_role_check` that `0064` later widens, so on populated data it fails
with *"check constraint is violated by some row"* and leaves the schema
half-applied.

The script refuses this now. If you only need the self-hosted follow-ups, which
is the usual reason to re-run:

```bash
npm run migrate:schema -- --follow-ups-only
```

Those are all `create or replace` and `grant`, so they are safe at any time. To
replay the base migrations you must rebuild: drop and recreate the database,
then run normally.

Prefer to go a step at a time:

```bash
npm run migrate:preflight   # is everything in place? read-only
npm run migrate:schema      # apply the schema
npm run migrate:data -- --dry-run
npm run migrate:data
npm run migrate:verify
```

**Order is not cosmetic**, and the schema step handles it for you. A stock
Postgres has no `auth` schema, no `storage` or `realtime` schemas, and none of
the `anon` / `authenticated` / `service_role` roles — Supabase provides all of
them implicitly, and the base migrations use them from `0001_papers.sql`
onwards, which puts a foreign key on `auth.users` and an RLS policy on
`auth.uid()`. So the self-hosted prerequisites run first, then
`supabase/migrations/*.sql` in name order, then the remaining follow-ups.

Expect roughly **40 tables and 109 policies** on a clean target — that figure
comes from a clean run against Postgres 16.13, and the repo has gained
migrations since, so somewhat higher is right. Substantially *lower* means
something failed quietly: re-run and read the **first** error, not the last.

## 2.3 ⚠️ The only line that matters

The run must end with **`Safe to cut over`**. If it does not, stop.

Verification makes four checks:

1. **Row counts**, table by table.
2. **Contents** — each table hashed, ordered by primary key. Byte-identical or
   it fails.
3. **Ownership** — every row's owner exists, and profiles kept their real role
   rather than the defaults a trigger would have written.
4. **Isolation** — it connects as `authenticated`, sets one user's claim, and
   asserts another user's rows are invisible.

The fourth is the one that matters most. **Postgres does not apply row-level
security to a table's owner**, so a misconfiguration there means every user can
read every other user's data — and none of the other three would notice. Row
counts would match. Content hashes would match. Everything would look perfect.

Do not point anything at that database until this passes.

---

# Stage 3 — Cut over

Stages 1 and 2 built a verified replica. This points the app at it.

## 3.1 ⚠️ The variable that looks right and is not

`NEXT_PUBLIC_BACKEND_PROVIDER=postgres` reads like the self-hosting switch. It
is not, and setting it in a deployed app breaks the browser bundle — it selects
the *server-side* adapter only. Twenty-two repositories run in the browser and
reach the database over HTTP through PostgREST; `this.db.from("papers")`
compiles to an HTTP call, and a browser cannot open a Postgres connection.

Leave it on `supabase`, permanently.

## 3.2 Test PostgREST first

On the VM:

```bash
curl -s http://localhost:3000/papers -H "Authorization: Bearer <a real token>" | head
```

An empty array `[]` is **success** — RLS is applied and that token owns no rows
here *yet*. `401` means the JWT secret does not match Supabase's. A row you
recognise means the copy worked and you are done.

## 3.3 Flip it

Two variables, in Vercel → Settings → Environment Variables:

```ini
NEXT_PUBLIC_DATA_URL=https://api.example.org
NEXT_PUBLIC_REALTIME_URL=https://api.example.org
```

Leave `NEXT_PUBLIC_SUPABASE_URL`, the anon key, and
`NEXT_PUBLIC_BACKEND_PROVIDER=supabase` exactly as they are. Redeploy.

Table reads and writes now go to your Postgres; sign-in and sessions still go to
Supabase.

### Why realtime has to move with the data

It reads earlier in this guide as though realtime could stay behind. It cannot,
and the failure is quiet enough to be worth spelling out.

Co-editing does not sync through the database — it is a broadcast channel, with
Realtime acting as a relay. The channel is opened `private: true`, which means
Realtime authorizes the join with an RLS policy on `realtime.messages`
(migration `0044`), and that policy calls `can_view_resource`, which reads
`vault_pages`, `papers` and `shares`.

Those reads happen in whatever database Realtime is connected to. Leave it on
Supabase after the data has moved and it authorizes against a copy frozen at
migration time:

- a note created after the cutover has no row there → **join denied, co-editing
  dead on that note**;
- a collaborator added after the cutover is invisible → **denied**;
- documents that existed before, with unchanged permissions, keep working.

Half the app syncs, half does not, and the editor reports nothing — it just
stops converging. So the stack runs its own Realtime against its own Postgres,
where the policy is asking about rows that are actually current.

Nothing else in the app changes. Only broadcast is used — there are no
`postgres_changes` subscriptions anywhere — so there is no replication slot,
publication, or WAL configuration to get right.

### After Realtime's first boot, re-apply the policies

Realtime runs its own migrations on startup and owns the `realtime` schema;
depending on version it replaces `realtime.messages`, taking the policies with
it. Put them back — this is safe to run against live data and is why the
follow-ups are separable:

```bash
DATABASE_URL="postgres://weaveforge:$PW@localhost:15432/weaveforge" \
  npm run migrate:schema -- --follow-ups-only
```

That also applies `0028_realtime_broadcast_policies.sql`, which authorizes the
`proj:{projectId}` cache-invalidation topic. `0044` only ever resolved `crdt:`
topics, so that channel had been failing closed since it shipped — harmlessly
(a stale tab refetches on its own schedule), which is why nobody noticed.

## 3.4 ⚠️ Get a certificate before anyone else uses it

Plain `http://…:3000` sends login tokens across the open internet unencrypted.
Anyone on the network path can read them and sign in as your users.

Acceptable for a shadow environment you are testing alone for an afternoon. Not
acceptable once the box is real. Two ways:

- **Cloudflare Tunnel** ([1.11](#111-optional--cloudflare-tunnel-instead-of-open-ports)) —
  the certificate comes free with the hostname, and the VM stops being
  reachable from the internet at the same time. If you are going to do the
  tunnel at all, do it here and skip Caddy.
- **Caddy or nginx** in front, if you would rather keep the box conventional.
  Caddy obtains and renews certificates automatically and is about five lines
  of config.

Either way, point `NEXT_PUBLIC_DATA_URL` at the `https://` address.

## 3.5 Verify through the app

- Sign in. *(This goes through Supabase either way — if it fails, the problem is
  auth config, not the migration.)*
- Open a paper, a note, the graph.
- **Create a new note, then open it in two browsers and type in both.** This is
  the check that catches a realtime still pointed at Supabase: an old note would
  sync and hide the problem, a new one will not sync at all.
- **Sign in as a second user and confirm you cannot see the first one's work.**
  Stage 2 proved this at the database; this proves it through the app.
- Write something, reload, confirm it persisted.

## 3.6 Rolling back

Remove `NEXT_PUBLIC_DATA_URL` and redeploy. Supabase still holds every row —
the migration never wrote to it and never deleted anything. About a minute.

If you had already been writing to Oracle and want those rows back, swap
`SOURCE_DATABASE_URL` and `DATABASE_URL` in `secrets/.env.migration` and run
`npm run migrate` again in the other direction.

---

# Optional — files

Only images and experiment artifacts live in storage. Papers are fetched from
arXiv and cached in the browser, so there is nothing to move for them.

```bash
npm run migrate:blobs -- --dry-run   # what is there
npm run migrate:blobs                # to R2 (hot tier)
npm run migrate:blobs -- --cold      # to MinIO on your VM (cold tier)
```

Nothing is deleted from Supabase Storage. Needs `SUPABASE_SERVICE_ROLE_KEY` and
the R2 variables in `secrets/.env.migration`. Skippable — do it once the database move
has settled.

To use MinIO as the cold tier, make its bucket first: open
`http://YOUR_PUBLIC_IP:9001`, sign in with `MINIO_ROOT_USER` /
`MINIO_ROOT_PASSWORD`, then **Buckets** → **Create bucket** →
`weaveforge-cold`. Then in your app's server environment:

```ini
BLOB_COLD_ENDPOINT=http://YOUR_PUBLIC_IP:9000
BLOB_COLD_ACCESS_KEY_ID=...
BLOB_COLD_SECRET_ACCESS_KEY=...
BLOB_COLD_BUCKET=weaveforge-cold
```

MinIO speaks path-style S3; the app sets that automatically whenever
`BLOB_COLD_ENDPOINT` is present. Hot-tier R2 setup is in
[`../storage/r2-setup.md`](storage/r2-setup.md).

---

# Reference

## Which variable goes where

| Variable | In the browser? | Notes |
|---|---|---|
| `NEXT_PUBLIC_DATA_URL` | yes | **The cutover switch.** Your PostgREST |
| `NEXT_PUBLIC_BACKEND_PROVIDER` | yes | Leave `supabase`. `postgres` breaks the bundle |
| `NEXT_PUBLIC_SUPABASE_URL` / anon key | yes | Auth. Never changes |
| `DATABASE_URL` | **never** | Server and scripts only |
| `SUPABASE_SERVICE_ROLE_KEY` | **never** | Server only |
| `BLOB_COLD_*` | **never** | Server only |

## Commands

```bash
npm run migrate:ping        # can I reach the target?
npm run migrate:preflight   # is everything in place? read-only
npm run migrate:schema      # apply the schema
npm run migrate:data        # copy the rows (--dry-run to preview)
npm run migrate:verify      # prove it worked
npm run migrate:blobs       # images and artifacts (--cold for MinIO)
npm run migrate             # all of the above, in order
```

## Do not skip these

The things that cause real damage rather than lost time.

1. **`lsblk` before `mkfs`.** Formatting the wrong disk destroys the VM.
2. **`Safe to cut over` before stage 3.** The isolation check is the only thing
   between you and every user reading every other user's data.
3. **Credentials live in `secrets/`, which is git-ignored.** Verify with `git check-ignore`, and never let a console download a key into the repo root.
4. **Session pooler, not transaction pooler**, for the Supabase URI.
5. **TLS before the box is real.** Tokens in the clear are account takeover.
6. **`netfilter-persistent save`**, or the firewall rules vanish on reboot.
7. **Delete the 9001 rule once the bucket exists.** It is a plain-HTTP login
   page holding root credentials to all your object storage.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Out of host capacity` creating the A1 instance | Ampere contention, not your mistake. Ask for a smaller shape (1 OCPU / 6 GB) and retry off-peak. Do **not** move region — Always Free block volumes are home-region only and would start billing. Full list in [1.5](#15-the-virtual-machine) |
| Connection **hangs**, then times out | Three candidates, in this order: no internet gateway / empty route table (1.2 — check this **first**, it is invisible from the instance page), the security list (1.3), or the VM's own iptables (1.4) |
| Times out and the security list looks perfect | Almost certainly the route table. A VCN made without the wizard has no gateway and no routes, so a VM with a public IP still has no path off the network. See 1.2 |
| A rule says "allows TCP traffic for ports: all" | Both port boxes are empty. The port goes in **Destination** Port Range; leave Source empty |
| Rule looks right, still nothing gets through | The port is in **Source** Port Range. That is the client's random port — move it to Destination |
| Connection **refused** | The port is open and nothing is listening — `docker compose ps` |
| `password authentication failed` | Does not match `POSTGRES_PASSWORD` in the VM's `.env` |
| `no pg_hba.conf entry for host` | The VM is not accepting your IP — security list and VM firewall |
| PostgREST restarts in a loop | Missing or malformed `SUPABASE_JWT_SECRET` |
| `401` from the data API | `SUPABASE_JWT_SECRET` is not the one Supabase signs with |
| CORS errors in the browser console | `CORS_ALLOWED_ORIGINS` does not include your app's origin |
| Every list empty after cutover, no error | `auth.uid()` returning null, so every policy denies. Re-apply the schema — `0000_self_host_prereqs.sql` reads both Supabase's claim shape and stock PostgREST's |
| `permission denied for table …` after cutover | `0026_self_host_grants.sql` did not apply. `npm run migrate:schema -- --follow-ups-only` |
| Requests return `200 []` for every table, anonymous correctly gets `401` | `auth.uid()` is returning null, so every policy denies. `0025` defines it reading only `request.jwt.claim.sub`, and PostgREST removed those legacy GUCs at v12 — from 12 on it sets only `request.jwt.claims`. Fixed by `0027`; apply with `--follow-ups-only` |
| `check constraint … is violated by some row` during `migrate:schema` | You are replaying base migrations over existing data. See the warning in 2.2 — rebuild, or use `--follow-ups-only` |
| **Users can see each other's data** | **Stop and roll back.** Either the app is not running as `authenticated` — check `pg-runner.ts` still issues `SET LOCAL ROLE` — or `DATABASE_URL` points at a superuser, which bypasses RLS regardless of role |
| `cannot insert a non-DEFAULT value into column` | A generated column — the target schema is a different version from the source. Re-apply migrations |
| Migration is slow | One round trip per table plus batched inserts; most of the wait is latency to Supabase |
| MinIO upload 403 | Wrong keys or bucket name; the endpoint needs `http://` and `:9000` |

## Keeping the box alive and healthy

Three things that stop a free VM quietly failing months later. All in
[`infra/oci/`](../../infra/oci/), installed as systemd timers.

### Oracle reclaims idle instances

An Always Free instance is reclaimed when, over a **7-day window**, *all three*
hold: CPU 95th percentile < 20%, network < 20%, and memory < 20% (A1 only). It
is an **AND**, so keeping any one above the line is enough.

[`keepalive.sh`](../../infra/oci/keepalive.sh) targets CPU: eight minutes of
one-core load per hour. A 95th percentile is crossed once more than 5% of
samples exceed 20%, so a short hourly burst clears it with margin — no need to
hold load continuously. One busy core of two reads as ~50%.

```bash
sudo install -m 755 keepalive.sh /usr/local/bin/weaveforge-keepalive
sudo systemctl enable --now weaveforge-keepalive.timer
```

⚠️ **Memory looks like the cheaper lever and is not.** `shared_buffers=3GB`
reserves address space, but Postgres pages it in lazily — a quiet box still
reports ~7% used and still counts as idle. It only becomes real once the
database is genuinely busy, which is exactly when you least need the
protection. Do not rely on it alone.

### A bucket quota, so MinIO cannot eat its volume

```bash
mc quota set local/weaveforge-cold --size 40gi
```

Writes past the limit fail with a quota error instead of filling the disk.
Without it, a runaway upload takes the volume down and there is no graceful
failure — just a full filesystem.

### Warning before a disk fills

[`disk-watch.sh`](../../infra/oci/disk-watch.sh) runs daily, logs to the journal
at 75% and 90%, and writes an MOTD banner so the warning is on screen the next
time you SSH in. No banner means all clear.

```bash
sudo install -m 755 disk-watch.sh /usr/local/bin/weaveforge-disk-watch
sudo systemctl enable --now weaveforge-disk-watch.timer
```

Volumes **expand online**, no downtime and no rebuild — and never shrink, so
start small and grow:

```bash
oci bv volume update --volume-id <ocid> --size-in-gbs 100
# then on the VM:
echo 1 | sudo tee /sys/class/block/sdX/device/rescan
sudo resize2fs /dev/sdX
```

## Hardening, once it is real

1. **TLS** — Caddy or nginx in front of PostgREST and MinIO.
2. **Firewall** — the full list is [1.3.2](#132-tightening-later): narrow 5432,
   delete the 9001 rule, close 3000 once Caddy fronts it, leave 22 to the key.
3. **Secrets** — rotate the Postgres and MinIO passwords; keep them only in
   Vercel's secret store.
4. **Backups** — OCI volume backups, or a `pg_dump` cron to Object Storage.
5. **Updates** — `docker compose pull && docker compose up -d`, monthly.

## Files in the repo

| Path | What |
|---|---|
| [`infra/oci/docker-compose.yml`](../../infra/oci/docker-compose.yml) | Postgres + PostgREST + MinIO |
| [`infra/oci/.env.example`](../../infra/oci/.env.example) | Template for the VM's `.env` |
| [`scripts/`](../../scripts/) | The `migrate:*` commands |
| [`supabase/migrations/`](../../supabase/migrations/) | Base schema |
| [`supabase/migrations-self-hosted-postgres/`](../../supabase/migrations-self-hosted-postgres/) | What Supabase provides implicitly and a stock Postgres does not |

## Related docs

| Doc | What it covers |
|---|---|
| [`postgres-provider.md`](postgres-provider.md) | What the `postgres` backend provider selects (the blob registry, not a data layer) |
| [`../self-host-roadmap.md`](../internal/strategy/self-host-roadmap.md) | Phase index — where each phase stands |
| [`../storage/r2-setup.md`](storage/r2-setup.md) | Cloudflare R2 hot tier |
| [`../../supabase/README.md`](../../supabase/README.md) | What each migrations folder means |
