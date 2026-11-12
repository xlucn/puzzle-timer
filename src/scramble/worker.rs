//! One thread owns the JavaScriptCore context.
//!
//! JSC contexts are neither `Send` nor `Sync`, and a 4x4 random-state scramble
//! can take a second, so the engine lives on a dedicated thread (invariant 4).
//! The UI sends plain-data jobs and receives plain-data results; it never
//! evaluates JS from the main thread.
//!
//! The result channel is an `async_channel` because glib 0.22 no longer carries
//! its own `MainContext::channel`; the UI drains it with
//! `glib::spawn_future_local`.

use std::sync::mpsc;
use std::thread::JoinHandle;

use crate::scramble::{DefaultEngine, Payload, ScrambleEngine};

/// One scramble request. `pre_scramble` is the diagram setup the module's
/// `preScr` global expects.
#[derive(Clone, Debug)]
pub struct Job {
    /// The feed's stamp, carried back so a stale result can be dropped.
    pub seq: u64,
    pub type_id: String,
    pub length: u32,
    pub pre_scramble: String,
    pub with_image: bool,
    /// csTimer's "fast" option: swap a slow solver for its random-move
    /// stand-in. The type the feed knows stays the real one, so a result is
    /// still matched to the right request.
    pub fast: bool,
}

/// The answer to a [`Job`].
#[derive(Clone, Debug)]
pub struct JobResult {
    pub seq: u64,
    pub type_id: String,
    pub result: Result<Payload, String>,
}

enum Message {
    Job(Job),
    Shutdown,
}

pub struct ScrambleWorker {
    jobs: mpsc::Sender<Message>,
    results: async_channel::Receiver<JobResult>,
    handle: Option<JoinHandle<()>>,
}

impl ScrambleWorker {
    /// Start the thread and create the engine on it, seeded once.
    pub fn spawn(seed: String) -> Self {
        let (job_tx, job_rx) = mpsc::channel::<Message>();
        let (result_tx, result_rx) = async_channel::unbounded::<JobResult>();

        let handle = std::thread::Builder::new()
            .name("scramble".into())
            .spawn(move || {
                let engine = DefaultEngine::new(&seed);
                while let Ok(message) = job_rx.recv() {
                    let job = match message {
                        Message::Job(job) => job,
                        Message::Shutdown => break,
                    };
                    let generator = if job.fast {
                        crate::core::scramble_types::fast_scramble_type(&job.type_id)
                            .unwrap_or(&job.type_id)
                    } else {
                        &job.type_id
                    };
                    let result = match &engine {
                        Ok(engine) => engine.generate(
                            generator,
                            job.length,
                            &job.pre_scramble,
                            job.with_image,
                        ),
                        Err(error) => Err(error.clone()),
                    };
                    let answer = JobResult {
                        seq: job.seq,
                        type_id: job.type_id,
                        result,
                    };
                    // The UI is gone: stop rather than queue forever.
                    if result_tx.send_blocking(answer).is_err() {
                        break;
                    }
                }
            })
            .expect("the scramble thread starts");

        Self {
            jobs: job_tx,
            results: result_rx,
            handle: Some(handle),
        }
    }

    /// Queue a job; the answer arrives on [`ScrambleWorker::results`].
    pub fn submit(&self, job: Job) {
        let _ = self.jobs.send(Message::Job(job));
    }

    /// The channel of finished jobs. Clone it for the main-loop future.
    pub fn results(&self) -> async_channel::Receiver<JobResult> {
        self.results.clone()
    }

    /// Stop the thread and wait for it. Joining waits for the current scramble,
    /// which is why the window calls this on close rather than on every switch.
    pub fn shutdown(&mut self) {
        let _ = self.jobs.send(Message::Shutdown);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for ScrambleWorker {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_on_its_own_thread_and_answers_in_order() {
        let worker = ScrambleWorker::spawn("42".into());
        worker.submit(Job {
            seq: 1,
            type_id: "333".into(),
            length: 0,
            pre_scramble: String::new(),
            with_image: true,
            fast: false,
        });
        worker.submit(Job {
            seq: 2,
            type_id: "222so".into(),
            length: 0,
            pre_scramble: String::new(),
            with_image: false,
            fast: false,
        });

        let first = worker.results().recv_blocking().expect("a result arrives");
        let second = worker.results().recv_blocking().expect("a result arrives");

        assert_eq!(first.seq, 1);
        assert_eq!(second.seq, 2);
        assert_eq!(second.type_id, "222so");
        let payload = first.result.expect("3x3 scramble");
        assert!(!payload.scramble.is_empty());
        assert!(payload.image.is_some());
        assert!(second.result.expect("2x2 scramble").image.is_none());
    }

    #[test]
    fn an_unknown_type_reports_an_error_instead_of_panicking() {
        let worker = ScrambleWorker::spawn("42".into());
        worker.submit(Job {
            seq: 7,
            type_id: "no-such-type".into(),
            length: 0,
            pre_scramble: String::new(),
            with_image: false,
            fast: false,
        });
        let answer = worker.results().recv_blocking().expect("a result arrives");
        assert_eq!(answer.seq, 7);
        assert!(answer.result.is_err() || answer.result.is_ok_and(|p| p.scramble.is_empty()));
    }

    #[test]
    fn shuts_down_and_closes_the_result_channel() {
        let mut worker = ScrambleWorker::spawn("42".into());
        let results = worker.results();
        worker.shutdown();
        assert!(results.recv_blocking().is_err());
    }
}
