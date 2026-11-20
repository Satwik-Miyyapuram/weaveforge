//! Write-back lease rules: one device at a time may write a document back. No I/O here.

/// Who holds the lease and until when.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Lease {
    /// The device that holds it.
    pub device: String,
    /// The user the device signed in as.
    pub user: String,
    /// Expiry in Unix milliseconds (lapsed when now >= this).
    pub until_ms: i64,
}

/// The answer to an acquire or renew.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LeaseReply {
    /// The caller holds the lease until `until_ms`.
    Granted {
        /// Expiry in Unix milliseconds.
        until_ms: i64,
    },
    /// Another device holds the lease.
    Denied {
        /// The holding device.
        holder: String,
        /// Its expiry in Unix milliseconds.
        until_ms: i64,
    },
    /// The caller does not hold the lease (any more).
    Lost,
}

/// One document's lease, with the length of each lease.
#[derive(Debug)]
pub struct LeaseBook {
    current: Option<Lease>,
    lease_ms: i64,
}

impl LeaseBook {
    /// A free book that grants leases of `lease_ms`.
    #[must_use]
    pub fn new(lease_ms: i64) -> Self {
        Self {
            current: None,
            lease_ms,
        }
    }

    /// Grants the lease if it is free, lapsed or already held by this device and user;
    /// otherwise denies it. A device id is client-supplied, so it only counts with its user.
    #[must_use]
    pub fn acquire(&mut self, device: &str, user: &str, now_ms: i64) -> LeaseReply {
        if let Some(held) = self
            .current
            .as_ref()
            .filter(|held| now_ms < held.until_ms && (held.device != device || held.user != user))
        {
            return LeaseReply::Denied {
                holder: held.device.clone(),
                until_ms: held.until_ms,
            };
        }
        let until_ms = now_ms.saturating_add(self.lease_ms);
        self.current = Some(Lease {
            device: device.to_owned(),
            user: user.to_owned(),
            until_ms,
        });
        LeaseReply::Granted { until_ms }
    }

    /// Extends the lease for the holder (device and user) while it is live; anything else is `Lost`.
    #[must_use]
    pub fn renew(&mut self, device: &str, user: &str, now_ms: i64) -> LeaseReply {
        let Some(held) = self.current.as_ref() else {
            return LeaseReply::Lost;
        };
        if now_ms >= held.until_ms {
            // A lapsed lease is cleared so the next acquire starts fresh.
            self.current = None;
            return LeaseReply::Lost;
        }
        if held.device != device || held.user != user {
            return LeaseReply::Lost;
        }
        let until_ms = now_ms.saturating_add(self.lease_ms);
        self.current = Some(Lease {
            until_ms,
            ..held.clone()
        });
        LeaseReply::Granted { until_ms }
    }

    /// Clears the lease if `device` and `user` hold it (lapsed or not); true when cleared.
    #[must_use]
    pub fn release(&mut self, device: &str, user: &str) -> bool {
        let ours = self
            .current
            .as_ref()
            .is_some_and(|held| held.device == device && held.user == user);
        if ours {
            self.current = None;
        }
        ours
    }

    /// The holder while its lease is still live at `now_ms`.
    #[must_use]
    pub fn live_holder(&self, now_ms: i64) -> Option<&Lease> {
        self.current.as_ref().filter(|held| now_ms < held.until_ms)
    }
}
