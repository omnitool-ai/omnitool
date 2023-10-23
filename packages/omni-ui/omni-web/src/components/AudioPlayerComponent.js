/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const audioPlayerComponent = function () {
  return {
    playlist: null,
    currentTrackIndex: 0,
    isLoading: true,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    setPlaylist(playlist) {
      this.playlist = playlist;
    },
    togglePlayPause() {
      const audio = this.$refs.audio;
      if (audio.paused) {
        audio.play();
      } else {
        audio.pause();
      }
    },
    loadTrack() {
      this.isLoading = true;
      this.isPlaying = false;
      this.audioURL = this.playlist?.[this.currentTrackIndex]?.url;
      this.$refs.audio.src = this.audioURL;
      if (this.$refs.audio.src) {
        this.$refs.audio.load();
      } else {
        console.error('Audio URL is not available or invalid');
      }
    },
    updateTime() {
      this.currentTime = this.$refs.audio.currentTime;
    },
    updateDuration() {
      this.duration = this.$refs.audio.duration;
    },
    seekAudio() {
      this.$refs.audio.currentTime = this.currentTime;
    },
    nextTrack() {
      if (this.currentTrackIndex < this.playlist.length - 1) {
        this.currentTrackIndex++;
      } else {
        this.currentTrackIndex = 0;
      }
      this.loadTrack();
    },
    formatTime(seconds) {
      const minutes = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
    }
  };
};

export { audioPlayerComponent };
