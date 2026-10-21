# ORIN original sonic family

| Asset | Duration | Intent |
|---|---:|---|
| standard | 0.78 s | General notification |
| opportunity | 0.95 s | Important opportunity |
| security | 1.10 s | Important security event |
| sonic-logo | 1.85 s | Limited brand animation use |

Each asset is included as mono 44.1kHz WAV (16-bit PCM), OGG/Vorbis and CAF (16-bit PCM). Source: `scripts/build-orin-audio.py`. All audio is newly synthesized from mathematical oscillators and envelopes for this project. No recordings, borrowed notification sounds or third-party samples were used; there are no sample licenses to purchase. These files are supplied for ORIN project use, without a claim of exclusive trademark rights or guaranteed uniqueness against every existing sound.

Regenerate with Python and FFmpeg installed: `python scripts/build-orin-audio.py`. Normalize conservatively; the current peak is approximately −10dBFS. Do not increase playback volume to bypass mute or DND. Use appropriate native system channels/categories. The web UI provides explicit tap-to-preview only; no automatic push sound is connected.
