use std::{fs::File, io::BufReader, path::Path};

use anyhow::{Context, Result};

pub struct AudioPreview {
    _sink_handle: rodio::MixerDeviceSink,
    player: rodio::Player,
}

impl AudioPreview {
    pub fn start(path: &Path) -> Result<Self> {
        let sink_handle = rodio::DeviceSinkBuilder::open_default_sink()
            .context("unable to open default audio output device")?;
        let file = File::open(path)
            .with_context(|| format!("unable to open audio file {}", path.display()))?;
        let player = rodio::play(sink_handle.mixer(), BufReader::new(file))
            .with_context(|| format!("unable to decode audio file {}", path.display()))?;

        Ok(Self {
            _sink_handle: sink_handle,
            player,
        })
    }

    pub fn stop(self) {
        self.player.stop();
    }
}

pub fn play_file_blocking(path: &Path) -> Result<()> {
    let preview = AudioPreview::start(path)?;

    preview.player.sleep_until_end();

    Ok(())
}
