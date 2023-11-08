/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const audioPlayerComponent = function () {
  return {
    playlist: null,
    setPlaylist(playlist) {
      this.playlist = playlist;
    },
  };
};

export { audioPlayerComponent };
