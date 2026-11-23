//! Per-user caps on co-editing sockets and open documents, so one account cannot hold the
//! relay's memory and file handles.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

/// Most sockets one user may have open at once, over all documents.
pub const MAX_SOCKETS_PER_USER: usize = 64;
/// Most distinct documents one user may have open at once.
pub const MAX_ROOMS_PER_USER: usize = 32;

/// Refusal text when the socket cap is reached.
pub const TOO_MANY_SOCKETS: &str = "Too many connections.";
/// Refusal text when the document cap is reached.
pub const TOO_MANY_ROOMS: &str = "Too many open documents.";

/// What one user holds now.
#[derive(Default)]
struct Usage {
    sockets: usize,
    /// Sockets per open document.
    rooms: HashMap<String, usize>,
}

/// Counts every user's sockets and documents.
#[derive(Default)]
pub struct Quota {
    users: Mutex<HashMap<String, Usage>>,
}

impl Quota {
    /// Takes one socket slot for `user` on `item_id`, or says which cap refused it.
    /// The slot is given back when the guard drops.
    ///
    /// # Errors
    /// [`TOO_MANY_SOCKETS`] or [`TOO_MANY_ROOMS`].
    pub fn acquire(
        self: &Arc<Self>,
        user: &str,
        item_id: &str,
    ) -> Result<QuotaGuard, &'static str> {
        let mut users = self.lock();
        let usage = users.entry(user.to_owned()).or_default();
        if usage.sockets >= MAX_SOCKETS_PER_USER {
            return Err(TOO_MANY_SOCKETS);
        }
        if !usage.rooms.contains_key(item_id) && usage.rooms.len() >= MAX_ROOMS_PER_USER {
            return Err(TOO_MANY_ROOMS);
        }
        usage.sockets += 1;
        *usage.rooms.entry(item_id.to_owned()).or_default() += 1;
        Ok(QuotaGuard {
            quota: Arc::clone(self),
            user: user.to_owned(),
            item_id: item_id.to_owned(),
        })
    }

    fn release(&self, user: &str, item_id: &str) {
        let mut users = self.lock();
        let Some(usage) = users.get_mut(user) else {
            return;
        };
        usage.sockets = usage.sockets.saturating_sub(1);
        if let Some(count) = usage.rooms.get_mut(item_id) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                let _ = usage.rooms.remove(item_id);
            }
        }
        if usage.sockets == 0 && usage.rooms.is_empty() {
            let _ = users.remove(user);
        }
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Usage>> {
        self.users.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// One held socket slot; dropping it gives the slot back.
pub struct QuotaGuard {
    quota: Arc<Quota>,
    user: String,
    item_id: String,
}

impl Drop for QuotaGuard {
    fn drop(&mut self) {
        self.quota.release(&self.user, &self.item_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn socket_cap_refuses_then_frees_on_drop() {
        let quota = Arc::new(Quota::default());
        let mut held: Vec<QuotaGuard> = (0..MAX_SOCKETS_PER_USER)
            .map(|_| quota.acquire("u", "doc").expect("under the cap"))
            .collect();
        assert_eq!(quota.acquire("u", "doc").err(), Some(TOO_MANY_SOCKETS));
        assert!(
            quota.acquire("other", "doc").is_ok(),
            "another user is not capped"
        );
        drop(held.pop());
        assert!(quota.acquire("u", "doc").is_ok());
    }

    #[test]
    fn room_cap_counts_distinct_documents() {
        let quota = Arc::new(Quota::default());
        let held: Vec<QuotaGuard> = (0..MAX_ROOMS_PER_USER)
            .map(|i| {
                quota
                    .acquire("u", &format!("doc-{i}"))
                    .expect("under the cap")
            })
            .collect();
        assert_eq!(quota.acquire("u", "doc-new").err(), Some(TOO_MANY_ROOMS));
        let again = quota
            .acquire("u", "doc-0")
            .expect("an open document takes more sockets");
        drop(again);
        drop(held);
        assert!(quota.lock().is_empty(), "every slot was given back");
    }

    #[test]
    fn closing_the_last_socket_frees_the_document() {
        let quota = Arc::new(Quota::default());
        let first = quota.acquire("u", "doc").expect("first");
        let second = quota.acquire("u", "doc").expect("second");
        drop(first);
        assert_eq!(quota.lock()["u"].rooms["doc"], 1);
        drop(second);
        assert!(quota.lock().is_empty());
    }
}
