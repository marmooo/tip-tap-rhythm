function loadConfig() {
  if (localStorage.getItem("darkMode") == 1) {
    document.documentElement.setAttribute("data-bs-theme", "dark");
  }
}

function toggleDarkMode() {
  if (localStorage.getItem("darkMode") == 1) {
    localStorage.setItem("darkMode", 0);
    document.documentElement.setAttribute("data-bs-theme", "light");
  } else {
    localStorage.setItem("darkMode", 1);
    document.documentElement.setAttribute("data-bs-theme", "dark");
  }
}

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

function getRectColor() {
  if (colorful) {
    const r = getRandomInt(0, 127);
    const g = getRandomInt(0, 127);
    const b = getRandomInt(0, 127);
    return `rgba(${r}, ${g}, ${b}, 0.5)`;
  } else {
    return "rgba(0, 0, 0, 0.3)";
  }
}

function setRectColor() {
  [...visualizer.svg.children].forEach((rect) => {
    const color = getRectColor();
    rect.setAttribute("fill", color);
  });
}

function toggleRectColor() {
  colorful = !colorful;
  setRectColor();
}

function dropFileEvent(event) {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.getElementById("inputMIDIFile");
  input.files = dt.files;
  loadMIDIFromBlob(file);
}

function loadMIDIFileEvent(event) {
  loadMIDIFromBlob(event.target.files[0]);
}

function loadMIDIUrlEvent(event) {
  loadMIDIFromUrl(event.target.value);
}

async function loadMIDIFromUrlParams() {
  const query = new URLSearchParams(location.search);
  ns = await core.urlToNoteSequence(query.get("url"));
  convert(ns, query);
}

async function loadMIDIFromBlob(file, query) {
  ns = await core.blobToNoteSequence(file);
  convert(ns, query);
}

async function loadMIDIFromUrl(midiUrl, query) {
  ns = await core.urlToNoteSequence(midiUrl);
  convert(ns, query);
}

function setMIDIInfo(query) {
  if (query instanceof URLSearchParams) {
    const title = query.get("title");
    const composer = query.get("composer");
    const maintainer = query.get("maintainer");
    const web = query.get("web");
    const license = query.get("license");
    document.getElementById("midiTitle").textContent = title;
    if (composer != maintainer) {
      document.getElementById("composer").textContent = composer;
    }
    if (web) {
      const a = document.createElement("a");
      a.href = web;
      a.textContent = maintainer;
      document.getElementById("maintainer").replaceChildren(a);
    } else {
      document.getElementById("maintainer").textContent = maintainer;
    }
    try {
      new URL(license);
    } catch {
      document.getElementById("license").textContent = license;
    }
  } else {
    document.getElementById("midiTitle").textContent = "";
    document.getElementById("composer").textContent = "";
    document.getElementById("maintainer").textContent = "";
    document.getElementById("license").textContent = "";
  }
}

function convertGM(ns) {
  ns.controlChanges = ns.controlChanges.filter((n) =>
    n.controlNumber == 0 || n.controlNumber == 32
  );
}

function convert(ns, query) {
  convertGM(ns);

  const waitTime = 3;
  longestDuration = -Infinity;
  ns.totalTime += waitTime;
  ns.notes.forEach((note) => {
    note.startTime += waitTime;
    note.endTime += waitTime;
    const duration = note.endTime - note.startTime;
    if (longestDuration < duration) longestDuration = duration;
  });
  ns.controlChanges.forEach((cc) => {
    cc.time += waitTime;
  });
  ns.tempos.slice(1).forEach((tempo) => {
    tempo.time += waitTime;
  });
  ns.timeSignatures.slice(1).forEach((ts) => {
    ts.time += waitTime;
  });
  ns.notes = ns.notes.sort((a, b) => {
    if (a.startTime < b.startTime) return -1;
    if (a.startTime > b.startTime) return 1;
    return 0;
  });
  nsCache = core.sequences.clone(ns);
  setMIDIInfo(query);
  initVisualizer();
  changeLevel();
  changeButtons();
  initPlayer();
}

async function loadSoundFontFileEvent(event) {
  if (player) {
    document.getElementById("soundfonts").options[0].selected = true;
    const file = event.target.files[0];
    const soundFontBuffer = await file.arrayBuffer();
    await player.loadSoundFontBuffer(soundFontBuffer);
  }
}

async function loadSoundFontUrlEvent(event) {
  if (player) {
    document.getElementById("soundfonts").options[0].selected = true;
    const response = await fetch(event.target.value);
    const soundFontBuffer = await response.arrayBuffer();
    await player.loadSoundFontBuffer(soundFontBuffer);
  }
}

function styleToViewBox(svg) {
  const style = svg.style;
  const width = parseFloat(style.width);
  const height = parseFloat(style.height);
  const viewBox = `0 0 ${width} ${height}`;
  svg.setAttribute("viewBox", viewBox);
  svg.removeAttribute("style");
}

function calcPixelsPerTimeStep() {
  let averageTime = 0;
  ns.notes.forEach((note) => {
    averageTime += note.endTime - note.startTime;
  });
  averageTime /= ns.notes.length;
  return noteHeight / averageTime;
}

const MIN_NOTE_LENGTH = 1;
class WaterfallSVGVisualizer extends core.BaseSVGVisualizer {
  // The default range is 21 < pitch <= 108, which only considers piano,
  // however we need 9 < pitch <= 120 when considering all instruments.
  NOTES_PER_OCTAVE = 12;
  WHITE_NOTES_PER_OCTAVE = 7;
  LOW_C = 12;
  firstDrawnOctave = 0;
  lastDrawnOctave = 8;

  // svgPiano;
  // config;

  constructor(sequence, parentElement, config = {}) {
    super(sequence, config);

    if (!(parentElement instanceof HTMLDivElement)) {
      throw new Error(
        "This visualizer requires a <div> element to display the visualization",
      );
    }

    // Some sensible defaults.
    this.config.whiteNoteWidth = config.whiteNoteWidth || 20;
    this.config.blackNoteWidth = config.blackNoteWidth ||
      this.config.whiteNoteWidth * 2 / 3;
    this.config.whiteNoteHeight = config.whiteNoteHeight || 70;
    this.config.blackNoteHeight = config.blackNoteHeight || (2 * 70 / 3);
    this.config.showOnlyOctavesUsed = config.showOnlyOctavesUsed;

    this.setupDOM(parentElement);

    const size = this.getSize();
    this.width = size.width;
    this.height = size.height;

    // Make sure that if we've used this svg element before, it's now emptied.
    this.svg.style.width = `${this.width}px`;
    this.svg.style.height = `${this.height}px`;

    this.svgPiano.style.width = `${this.width}px`;
    this.svgPiano.style.height = `${this.config.whiteNoteHeight}px`;

    // Add a little bit of padding to the right, so that the scrollbar
    // doesn't overlap the last note on the piano.
    this.parentElement.style.width = `${
      this.width + this.config.whiteNoteWidth
    }px`;
    this.parentElement.scrollTop = this.parentElement.scrollHeight;

    this.clear();
    this.drawPiano();
    this.draw();
  }

  setupDOM(container) {
    this.parentElement = document.createElement("div");
    this.parentElement.classList.add("waterfall-notes-container");

    const height = Math.max(container.getBoundingClientRect().height, 200);

    // Height and padding-top must match for this to work.
    this.parentElement.style.paddingTop = `${
      height - this.config.whiteNoteHeight
    }px`;
    this.parentElement.style.height = `${
      height - this.config.whiteNoteHeight
    }px`;

    this.parentElement.style.boxSizing = "border-box";
    this.parentElement.style.overflowX = "hidden";
    this.parentElement.style.overflowY = "auto";

    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svgPiano = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    this.svg.classList.add("waterfall-notes");
    this.svgPiano.classList.add("waterfall-piano");

    this.parentElement.appendChild(this.svg);
    container.innerHTML = "";
    container.appendChild(this.parentElement);
    container.appendChild(this.svgPiano);
  }
  /**
   * Redraws the entire note sequence if it hasn't been drawn before,
   * optionally painting a note as active
   * @param activeNote (Optional) If specified, this `Note` will be painted
   * in the active color.
   * @param scrollIntoView (Optional) If specified and the note being
   * painted is offscreen, the parent container will be scrolled so that
   * the note is in view.
   * @returns The x position of the painted active note. Useful for
   * automatically advancing the visualization if the note was painted
   * outside of the screen.
   */
  redraw(activeNote, _scrollIntoView) {
    if (!this.drawn) {
      this.draw();
    }

    if (!activeNote) {
      return null;
    }

    // Remove the current active note, if one exists.
    this.clearActiveNotes();
    this.parentElement.style.paddingTop = this.parentElement.style.height;

    for (let i = 0; i < this.noteSequence.notes.length; i++) {
      const note = this.noteSequence.notes[i];
      const isActive = activeNote &&
        this.isPaintingActiveNote(note, activeNote);

      // We're only looking to re-paint the active notes.
      if (!isActive) {
        continue;
      }

      // Activate this note.
      const el = this.svg.querySelector(`rect[data-index="${i}"]`);
      this.fillActiveRect(el, note);

      // And on the keyboard.
      const key = this.svgPiano.querySelector(
        `rect[data-pitch="${note.pitch}"]`,
      );
      this.fillActiveRect(key, note);

      if (note === activeNote) {
        const y = parseFloat(el.getAttribute("y"));
        const height = parseFloat(el.getAttribute("height"));

        // Scroll the waterfall.
        if (y < (this.parentElement.scrollTop - height)) {
          this.parentElement.scrollTop = y + height;
        }

        // This is the note we wanted to draw.
        return y;
      }
    }
    return null;
  }

  getSize() {
    this.updateMinMaxPitches(true);

    let whiteNotesDrawn = 52; // For a full piano.
    if (this.config.showOnlyOctavesUsed) {
      // Go through each C note and see which is the one right below and
      // above our sequence.
      let foundFirst = false, foundLast = false;
      for (let i = 1; i < 7; i++) {
        const c = this.LOW_C + this.NOTES_PER_OCTAVE * i;
        // Have we found the lowest pitch?
        if (!foundFirst && c > this.config.minPitch) {
          this.firstDrawnOctave = i - 1;
          foundFirst = true;
        }
        // Have we found the highest pitch?
        if (!foundLast && c > this.config.maxPitch) {
          this.lastDrawnOctave = i - 1;
          foundLast = true;
        }
      }

      whiteNotesDrawn = (this.lastDrawnOctave - this.firstDrawnOctave + 1) *
        this.WHITE_NOTES_PER_OCTAVE;
    }

    const width = whiteNotesDrawn * this.config.whiteNoteWidth;

    // Calculate a nice width based on the length of the sequence we're
    // playing.
    // Warn if there's no totalTime or quantized steps set, since it leads
    // to a bad size.
    const endTime = this.noteSequence.totalTime;
    if (!endTime) {
      throw new Error(
        "The sequence you are using with the visualizer does not have a " +
          "totalQuantizedSteps or totalTime " +
          "field set, so the visualizer can't be horizontally " +
          "sized correctly.",
      );
    }

    const height = Math.max(
      endTime * this.config.pixelsPerTimeStep,
      MIN_NOTE_LENGTH,
    );
    return { width, height };
  }

  getNotePosition(note, _noteIndex) {
    const rect = this.svgPiano.querySelector(
      `rect[data-pitch="${note.pitch}"]`,
    );

    if (!rect) {
      return null;
    }

    // Size of this note.
    const len = this.getNoteEndTime(note) - this.getNoteStartTime(note);
    const x = Number(rect.getAttribute("x"));
    const w = Number(rect.getAttribute("width"));
    const h = Math.max(
      this.config.pixelsPerTimeStep * len - this.config.noteSpacing,
      MIN_NOTE_LENGTH,
    );

    // The svg' y=0 is at the top, but a smaller pitch is actually
    // lower, so we're kind of painting backwards.
    const y = this.height -
      (this.getNoteStartTime(note) * this.config.pixelsPerTimeStep) - h;
    return { x, y, w, h };
  }

  drawPiano() {
    this.svgPiano.innerHTML = "";

    const blackNoteOffset = this.config.whiteNoteWidth -
      this.config.blackNoteWidth / 2;
    const blackNoteIndexes = [1, 3, 6, 8, 10];

    // Dear future reader: I am sure there is a better way to do this, but
    // splitting it up makes it more readable and maintainable in case there's
    // an off by one key error somewhere.
    // Each note has an pitch. Pianos start on pitch 21 and end on 108.
    // First draw all the white notes, in this order:
    //    - if we're using all the octaves, pianos start on an A (so draw A,
    //    B)
    //    - ... the rest of the white keys per octave
    //    - if we started on an A, we end on an extra C.
    // Then draw all the black notes (so that these rects sit on top):
    //    - if the piano started on an A, draw the A sharp
    //    - ... the rest of the black keys per octave.

    let x = 0;
    let currentPitch = 0;
    if (this.config.showOnlyOctavesUsed) {
      // Starting on a C, and a bunch of octaves up.
      currentPitch = (this.firstDrawnOctave * this.NOTES_PER_OCTAVE) +
        this.LOW_C;
    } else {
      // Starting on the lowest A and B.
      currentPitch = this.LOW_C - 3;
      this.drawWhiteKey(currentPitch, x);
      this.drawWhiteKey(currentPitch + 2, this.config.whiteNoteWidth);
      currentPitch += 3;
      x = 2 * this.config.whiteNoteWidth;
    }

    // Draw the rest of the white notes.
    for (let o = this.firstDrawnOctave; o <= this.lastDrawnOctave; o++) {
      for (let i = 0; i < this.NOTES_PER_OCTAVE; i++) {
        // Black keys come later.
        if (blackNoteIndexes.indexOf(i) === -1) {
          this.drawWhiteKey(currentPitch, x);
          x += this.config.whiteNoteWidth;
        }
        currentPitch++;
      }
    }

    if (this.config.showOnlyOctavesUsed) {
      // Starting on a C, and a bunch of octaves up.
      currentPitch = (this.firstDrawnOctave * this.NOTES_PER_OCTAVE) +
        this.LOW_C;
      x = -this.config.whiteNoteWidth;
    } else {
      // Before we reset, add an extra C at the end because pianos.
      this.drawWhiteKey(currentPitch, x);

      // This piano started on an A, so draw the A sharp black key.
      currentPitch = this.LOW_C - 3;
      this.drawBlackKey(currentPitch + 1, blackNoteOffset);
      currentPitch += 3; // Next one is the LOW_C.
      x = this.config.whiteNoteWidth;
    }

    // Draw the rest of the black notes.
    for (let o = this.firstDrawnOctave; o <= this.lastDrawnOctave; o++) {
      for (let i = 0; i < this.NOTES_PER_OCTAVE; i++) {
        if (blackNoteIndexes.indexOf(i) !== -1) {
          this.drawBlackKey(currentPitch, x + blackNoteOffset);
        } else {
          x += this.config.whiteNoteWidth;
        }
        currentPitch++;
      }
    }
  }

  drawWhiteKey(index, x) {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.dataset.pitch = String(index);
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", "0");
    rect.setAttribute("width", String(this.config.whiteNoteWidth));
    rect.setAttribute("height", String(this.config.whiteNoteHeight));
    rect.setAttribute("fill", "white");
    rect.setAttribute("original-fill", "white");
    rect.setAttribute("stroke", "black");
    rect.setAttribute("stroke-width", "3px");
    rect.classList.add("white");
    this.svgPiano.appendChild(rect);
    return rect;
  }

  drawBlackKey(index, x) {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.dataset.pitch = String(index);
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", "0");
    rect.setAttribute("width", String(this.config.blackNoteWidth));
    rect.setAttribute("height", String(this.config.blackNoteHeight));
    rect.setAttribute("fill", "black");
    rect.setAttribute("original-fill", "black");
    rect.setAttribute("stroke", "black");
    rect.setAttribute("stroke-width", "3px");
    rect.classList.add("black");
    this.svgPiano.appendChild(rect);
    return rect;
  }

  clearActiveNotes() {
    super.unfillActiveRect(this.svg);
    // And the piano.
    const els = this.svgPiano.querySelectorAll("rect.active");
    for (let i = 0; i < els.length; ++i) {
      const el = els[i];
      el.setAttribute("fill", el.getAttribute("original-fill"));
      el.classList.remove("active");
    }
  }
}

function initVisualizer() {
  const gamePanel = document.getElementById("gamePanel");
  const config = {
    showOnlyOctavesUsed: true,
    pixelsPerTimeStep: calcPixelsPerTimeStep(),
  };
  visualizer = new WaterfallSVGVisualizer(ns, gamePanel, config);
  styleToViewBox(visualizer.svg);
  styleToViewBox(visualizer.svgPiano);
  visualizer.svgPiano.classList.add("d-none");
  setRectColor();
  const parentElement = visualizer.parentElement;
  parentElement.style.width = "100%";
  parentElement.style.height = "50vh";
  parentElement.style.paddingTop = "50vh";
  parentElement.style.overflowY = "hidden";
  resize();
  changeVisualizerPositions(visualizer);
}

class MagentaPlayer extends core.SoundFontPlayer {
  constructor(ns, runCallback, stopCallback) {
    const soundFontUrl =
      "https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus";
    const callback = {
      run: (note) => runCallback(note),
      stop: () => stopCallback(),
    };
    super(soundFontUrl, undefined, undefined, undefined, callback);
    this.ns = ns;
    this.output.volume.value = 20 * Math.log(0.5) / Math.log(10);
  }

  loadSamples(ns) {
    return super.loadSamples(ns).then(() => {
      this.synth = true;
    });
  }

  start(ns) {
    return super.start(ns);
  }

  restart(seconds) {
    if (seconds) {
      return super.start(ns, undefined, seconds / ns.ticksPerQuarter);
    } else {
      return this.start(this.ns);
    }
  }

  resume(seconds) {
    super.resume();
    this.seekTo(seconds);
  }

  changeVolume(volume) {
    // 0 <= volume <= 100 --> 1e-5 <= dB <= 1 --> -100 <= slider <= 0
    if (volume == 0) {
      volume = -100;
    } else {
      volume = 20 * Math.log(volume / 100) / Math.log(10);
    }
    this.output.volume.value = volume;
  }

  changeMute(status) {
    this.output.mute = status;
  }
}

class SoundFontPlayer {
  constructor(stopCallback) {
    this.context = new AudioContext();
    this.state = "stopped";
    this.noCallback = false;
    this.stopCallback = stopCallback;
    this.prevGain = 0.5;
    this.cacheUrls = new Array(128);
    this.totalTicks = 0;
  }

  async loadSoundFontDir(programs, dir) {
    const promises = programs.map((program) => {
      const programId = program.toString().padStart(3, "0");
      const url = `${dir}/${programId}.sf3`;
      if (this.cacheUrls[program] == url) return true;
      this.cacheUrls[program] = url;
      return this.fetchBuffer(url);
    });
    const buffers = await Promise.all(promises);
    for (const buffer of buffers) {
      if (buffer instanceof ArrayBuffer) {
        await this.loadSoundFontBuffer(buffer);
      }
    }
  }

  async fetchBuffer(url) {
    const response = await fetch(url);
    if (response.status == 200) {
      return await response.arrayBuffer();
    } else {
      return undefined;
    }
  }

  async loadSoundFontUrl(url) {
    const buffer = await this.fetchBuffer(url);
    const soundFontId = await this.loadSoundFontBuffer(buffer);
    return soundFontId;
  }

  async loadSoundFontBuffer(soundFontBuffer) {
    if (!this.synth) {
      await JSSynthPromise;
      await this.context.audioWorklet.addModule(
        "https://cdn.jsdelivr.net/npm/js-synthesizer@1.8.5/externals/libfluidsynth-2.3.0-with-libsndfile.min.js",
      );
      await this.context.audioWorklet.addModule(
        "https://cdn.jsdelivr.net/npm/js-synthesizer@1.8.5/dist/js-synthesizer.worklet.min.js",
      );
      this.synth = new JSSynth.AudioWorkletNodeSynthesizer();
      this.synth.init(this.context.sampleRate);
      const node = this.synth.createAudioNode(this.context);
      node.connect(this.context.destination);
    }
    const soundFontId = await this.synth.loadSFont(soundFontBuffer);
    return soundFontId;
  }

  async loadNoteSequence(ns) {
    await this.synth.resetPlayer();
    this.ns = ns;
    const midiBuffer = core.sequenceProtoToMidi(ns);
    this.totalTicks = this.calcTick(ns.totalTime);
    return this.synth.addSMFDataToPlayer(midiBuffer);
  }

  resumeContext() {
    this.context.resume();
  }

  async restart(seconds) {
    this.state = "started";
    await this.synth.playPlayer();
    if (seconds) this.seekTo(seconds);
    await this.synth.waitForPlayerStopped();
    await this.synth.waitForVoicesStopped();
    this.state = "paused";
    if (!this.noCallback) {
      player.seekTo(0);
      this.stopCallback();
    }
    this.noCallback = false;
  }

  async start(ns, _qpm, seconds) {
    if (ns) await this.loadNoteSequence(ns);
    if (seconds) this.seekTo(seconds);
    this.restart();
  }

  stop(noCallback) {
    if (noCallback) this.noCallback = true;
    if (this.synth) this.synth.stopPlayer();
  }

  pause() {
    this.state = "paused";
    this.noCallback = true;
    this.synth.stopPlayer();
  }

  resume(seconds) {
    this.restart(seconds);
  }

  changeVolume(volume) {
    // 0 <= volume <= 1
    volume = volume / 100;
    this.synth.setGain(volume);
  }

  changeMute(status) {
    if (status) {
      this.prevGain = this.synth.getGain();
      this.synth.setGain(0);
    } else {
      this.synth.setGain(this.prevGain);
    }
  }

  calcTick(seconds) {
    let tick = 0;
    let prevTime = 0;
    let prevQpm = 120;
    for (const tempo of this.ns.tempos) {
      const currTime = tempo.time;
      const currQpm = tempo.qpm;
      if (currTime < seconds) {
        const t = currTime - prevTime;
        tick += prevQpm / 60 * t * this.ns.ticksPerQuarter;
      } else {
        const t = seconds - prevTime;
        tick += prevQpm / 60 * t * this.ns.ticksPerQuarter;
        return Math.round(tick);
      }
      prevTime = currTime;
      prevQpm = currQpm;
    }
    const t = seconds - prevTime;
    tick += prevQpm / 60 * t * this.ns.ticksPerQuarter;
    return Math.floor(tick);
  }

  seekTo(seconds) {
    const tick = this.calcTick(seconds);
    this.synth.seekPlayer(tick);
  }

  isPlaying() {
    if (!this.synth) return false;
    return this.synth.isPlaying();
  }

  getPlayState() {
    if (!this.synth) return "stopped";
    if (this.synth.isPlaying()) return "started";
    return this.state;
  }
}

function stopCallback() {
  clearInterval(timer);
  currentTime = 0;
  initSeekbar(ns, 0);
  visualizer.parentElement.scrollTop = visualizer.parentElement.scrollHeight;
  clearPlayer();
  const repeatObj = document.getElementById("repeat");
  const repeat = repeatObj.classList.contains("active");
  if (repeat) play();
  scoring();
  scoreModal.show();
  [...visualizer.svg.getElementsByClassName("fade")].forEach((rect) => {
    rect.classList.remove("fade");
  });
}

async function initPlayer() {
  disableController();
  if (player) player.stop(true);
  clearPlayer();
  currentTime = 0;
  initSeekbar(ns, 0);

  // // Magenta.js
  // const runCallback = () => {};
  // player = new MagentaPlayer(ns, runCallback, stopCallback);
  // await player.loadSamples(ns);

  // js-synthesizer
  player = new SoundFontPlayer(stopCallback);
  if (firstRun) {
    firstRun = false;
    await loadSoundFont(player, "GeneralUser_GS_v1.471");
  } else {
    await loadSoundFont(player);
  }

  enableController();
}

function getPrograms(ns) {
  const programs = new Set();
  ns.notes.forEach((note) => programs.add(note.program));
  if (ns.notes.some((note) => note.isDrum)) programs.add(128);
  return [...programs];
}

async function loadSoundFont(player, name) {
  if (!name) {
    const soundfonts = document.getElementById("soundfonts");
    const index = soundfonts.selectedIndex;
    if (index == 0) return; // use local file or url
    name = soundfonts.options[index].value;
  }
  const soundFontDir = `https://soundfonts.pages.dev/${name}`;
  const programs = getPrograms(ns);
  await player.loadSoundFontDir(programs, soundFontDir);
  await player.loadNoteSequence(ns);
}

function setTimer(seconds) {
  const delay = 1;
  const startTime = Date.now() - seconds * 1000;
  const totalTime = ns.totalTime;
  clearInterval(timer);
  timer = setInterval(() => {
    const nextTime = (Date.now() - startTime) / 1000;
    if (Math.floor(currentTime) != Math.floor(nextTime)) {
      updateSeekbar(nextTime);
    }
    currentTime = nextTime;
    if (currentTime < totalTime) {
      const rate = 1 - currentTime / totalTime;
      visualizer.parentElement.scrollTop = currentScrollHeight * rate;
    } else {
      clearInterval(timer);
    }
  }, delay);
}

// fix delay caused by player.start(ns) by seeking after playing
function setLoadingTimer(time) {
  const loadingTimer = setInterval(() => {
    if (player.isPlaying()) {
      clearInterval(loadingTimer);
      player.seekTo(time);
      setTimer(time);
      enableController();
    }
  }, 10);
}

function disableController() {
  controllerDisabled = true;
  const target = document.getElementById("controller")
    .querySelectorAll("button, input");
  [...target].forEach((node) => {
    node.disabled = true;
  });
}

function enableController() {
  controllerDisabled = false;
  const target = document.getElementById("controller")
    .querySelectorAll("button, input");
  [...target].forEach((node) => {
    node.disabled = false;
  });
}

function unlockAudio() {
  if (!player) return;
  if (!player.synth) return;
  player.resumeContext();
  document.removeEventListener("click", unlockAudio);
}

function play() {
  tapCount = perfectCount = greatCount = 0;
  disableController();
  document.getElementById("play").classList.add("d-none");
  document.getElementById("pause").classList.remove("d-none");
  switch (player.getPlayState()) {
    case "stopped":
      initSeekbar(ns, currentTime);
      setLoadingTimer(currentTime);
      player.restart();
      break;
    case "started":
    case "paused":
      player.resume(currentTime);
      setTimer(currentTime);
      enableController();
      break;
  }
  globalThis.scrollTo({
    top: document.getElementById("playPanel").getBoundingClientRect().top,
    behavior: "auto",
  });
}

function pause() {
  player.pause();
  clearPlayer();
}

function clearPlayer() {
  clearInterval(timer);
  document.getElementById("play").classList.remove("d-none");
  document.getElementById("pause").classList.add("d-none");
}

function speedDown() {
  if (player.isPlaying()) disableController();
  const input = document.getElementById("speed");
  const value = parseInt(input.value) - 10;
  const speed = (value <= 0) ? 1 : value;
  input.value = speed;
  changeSpeed(speed);
}

function speedUp() {
  if (player.isPlaying()) disableController();
  const input = document.getElementById("speed");
  const speed = parseInt(input.value) + 10;
  input.value = speed;
  changeSpeed(speed);
}

async function changeSpeed(speed) {
  perfectCount = greatCount = 0;
  if (!ns) return;
  const playState = player.getPlayState();
  player.stop(true);
  clearInterval(timer);
  const prevRate = nsCache.totalTime / ns.totalTime;
  const rate = prevRate / (speed / 100);
  const newSeconds = currentTime * rate;
  setSpeed(ns, speed);
  initSeekbar(ns, newSeconds);
  if (playState == "started") {
    setLoadingTimer(newSeconds);
    player.start(ns);
  } else if (player instanceof SoundFontPlayer) {
    await player.loadNoteSequence(ns);
    player.seekTo(newSeconds);
  }
}

function changeSpeedEvent(event) {
  if (player.isPlaying()) disableController();
  const speed = parseInt(event.target.value);
  changeSpeed(speed);
}

function setSpeed(ns, speed) {
  if (speed <= 0) speed = 1;
  speed /= 100;
  const controlChanges = nsCache.controlChanges;
  ns.controlChanges.forEach((n, i) => {
    n.time = controlChanges[i].time / speed;
  });
  const tempos = nsCache.tempos;
  ns.tempos.forEach((n, i) => {
    n.time = tempos[i].time / speed;
    n.qpm = tempos[i].qpm * speed;
  });
  const timeSignatures = nsCache.timeSignatures;
  ns.timeSignatures.forEach((n, i) => {
    n.time = timeSignatures[i].time / speed;
  });
  const notes = nsCache.notes;
  ns.notes.forEach((n, i) => {
    n.startTime = notes[i].startTime / speed;
    n.endTime = notes[i].endTime / speed;
  });
  ns.totalTime = nsCache.totalTime / speed;
}

function repeat() {
  document.getElementById("repeat").classList.toggle("active");
}

function volumeOnOff() {
  const i = document.getElementById("volumeOnOff").firstElementChild;
  const volumebar = document.getElementById("volumebar");
  if (i.classList.contains("bi-volume-up-fill")) {
    i.className = "bi bi-volume-mute-fill";
    volumebar.dataset.value = volumebar.value;
    volumebar.value = 0;
    player.changeMute(true);
  } else {
    i.className = "bi bi-volume-up-fill";
    volumebar.value = volumebar.dataset.value;
    player.changeMute(false);
  }
}

function changeVolumebar() {
  const volumebar = document.getElementById("volumebar");
  const volume = parseInt(volumebar.value);
  volumebar.dataset.value = volume;
  player.changeVolume(volume);
}

function formatTime(seconds) {
  seconds = Math.floor(seconds);
  const s = seconds % 60;
  const m = (seconds - s) / 60;
  const h = (seconds - s - 60 * m) / 3600;
  const ss = String(s).padStart(2, "0");
  const mm = (m > 9 || !h) ? `${m}:` : `0${m}:`;
  const hh = h ? `${h}:` : "";
  return `${hh}${mm}${ss}`;
}

function changeSeekbar(event) {
  perfectCount = greatCount = 0;
  clearInterval(timer);
  [...visualizer.svg.getElementsByClassName("fade")].forEach((rect) => {
    rect.classList.remove("fade");
  });
  currentTime = parseInt(event.target.value);
  document.getElementById("currentTime").textContent = formatTime(currentTime);
  seekScroll(currentTime);
  if (player.getPlayState() == "started") {
    player.seekTo(currentTime);
    setTimer(currentTime);
  }
}

function updateSeekbar(seconds) {
  const seekbar = document.getElementById("seekbar");
  seekbar.value = seconds;
  const time = formatTime(seconds);
  document.getElementById("currentTime").textContent = time;
}

function initSeekbar(ns, seconds) {
  document.getElementById("seekbar").max = ns.totalTime;
  document.getElementById("seekbar").value = seconds;
  document.getElementById("totalTime").textContent = formatTime(ns.totalTime);
  document.getElementById("currentTime").textContent = formatTime(seconds);
}

function loadSoundFontList() {
  return fetch("https://soundfonts.pages.dev/list.json")
    .then((response) => response.json())
    .then((data) => {
      const soundfonts = document.getElementById("soundfonts");
      data.forEach((info) => {
        const option = document.createElement("option");
        option.textContent = info.name;
        if (info.name == "GeneralUser_GS_v1.471") {
          option.selected = true;
        }
        soundfonts.appendChild(option);
      });
    });
}

async function changeConfig() {
  switch (player.getPlayState()) {
    case "started": {
      player.stop(true);
      if (player instanceof SoundFontPlayer) {
        await loadSoundFont(player);
      }
      const speed = parseInt(document.getElementById("speed").value);
      setSpeed(ns, speed);
      const seconds = parseInt(document.getElementById("seekbar").value);
      initSeekbar(ns, seconds);
      setLoadingTimer(seconds);
      player.start(ns);
      break;
    }
    case "paused":
      configChanged = true;
      break;
  }
}

function resize() {
  const parentElement = visualizer.parentElement;
  const rectHeight = parentElement.getBoundingClientRect().height;
  currentScrollHeight = parentElement.scrollHeight - rectHeight;
  seekScroll(currentTime);
}

function seekScroll(time) {
  const rate = (ns.totalTime - time) / ns.totalTime;
  visualizer.parentElement.scrollTop = currentScrollHeight * rate;
}

function getMinMaxPitch() {
  let min = Infinity;
  let max = -Infinity;
  ns.notes.forEach((note) => {
    if (note.pitch < min) min = note.pitch;
    if (max < note.pitch) max = note.pitch;
  });
  return [min, max];
}

function calcNoteFrequency(level) {
  const difficulty = ns.notes.length / ns.totalTime;
  switch (level) {
    case 1:
      return Math.ceil(difficulty / 0.5);
    case 2:
      return Math.ceil(difficulty);
    case 3:
      return Math.ceil(difficulty / 1.5);
    case 4:
      return Math.ceil(difficulty / 2);
    case 5:
      return Math.ceil(difficulty / 2.5);
    case 6:
      return Math.ceil(difficulty / 3);
  }
}

function splitInstruments(notes) {
  let instrument = 0;
  let pos = 0;
  const result = [];
  notes.forEach((n, i) => {
    if (n.instrument != instrument) {
      result.push(notes.slice(pos, i));
      instrument += 1;
      pos = i;
    }
  });
  result.push(notes.slice(pos));
  return result;
}

function _removeChord(rects) {
  let instrumentPos = 0;
  splitInstruments(ns.notes).forEach((ins) => {
    const set = new Set();
    ins.forEach((note, i) => {
      const key = note.startTime * note.endTime;
      if (set.has(key)) {
        const pos = instrumentPos + i;
        rects[pos].classList.add("d-none");
      } else {
        set.add(key);
      }
    });
    instrumentPos += ins.length;
  });
}

function changeLevel() {
  tapCount = perfectCount = greatCount = 0;
  const level = document.getElementById("levelOption").selectedIndex;
  const noteFrequency = calcNoteFrequency(level);
  const map = new Map();
  ns.notes.forEach((note) => {
    map.set(note.instrument, false);
  });
  const notes = ns.notes;
  const rects = [...visualizer.svg.children];
  let i = 0;
  rects.forEach((rect, pos) => {
    if (i % noteFrequency == 0) {
      rect.classList.remove("d-none");
      notes[pos].target = true;
    } else {
      rect.classList.add("d-none");
      notes[pos].target = false;
    }
    i += 1;
  });
  // _removeChord(rects);
}

function changeVisualizerPositions(visualizer) {
  const [minPitch, maxPitch] = getMinMaxPitch();
  const pitchRange = maxPitch - minPitch + 1;
  const course = document.getElementById("courseOption").selectedIndex;
  const courseStep = pitchRange / course;
  const viewBox = visualizer.svg.getAttribute("viewBox").split(" ");
  const svgWidth = parseFloat(viewBox[2]);
  const widthStep = svgWidth / course;
  [...visualizer.svg.children]
    .map((rect) => {
      const height = parseFloat(rect.getAttribute("height"));
      const y = parseFloat(rect.getAttribute("y"));
      if (height < noteHeight) {
        rect.setAttribute("height", noteHeight);
        rect.setAttribute("y", y - noteHeight + height);
      }
      return rect;
    })
    .forEach((rect, i) => {
      const pitch = parseInt(rect.dataset.pitch);
      const n = Math.floor((pitch - minPitch) / courseStep);
      rect.setAttribute("x", Math.ceil(n * widthStep));
      rect.setAttribute("width", widthStep);
      ns.notes[i].button = n;
    });
}

function typeEvent(event) {
  if (!player || !player.synth) return;
  if (controllerDisabled) return;
  player.resumeContext();
  switch (event.code) {
    case "Space":
      event.preventDefault();
      if (player.getPlayState() == "started") {
        pause();
      } else {
        play();
      }
      break;
    default:
      return typeEventKey(event.key);
  }
}

function typeEventKey(key) {
  const course = document.getElementById("courseOption").selectedIndex;
  const letters = Array.from("AWSEDRFTGYHUJIKOLP;@".toLowerCase());
  const targetLetters = (course > 10)
    ? letters.slice(0, course)
    : letters.filter((_, i) => i % 2 == 0).slice(0, course);
  const pos = targetLetters.indexOf(key);
  if (pos != -1) keyEvents[pos]();
}

function searchNotePosition(notes, time) {
  let left = 0;
  let right = notes.length - 1;
  if (time < notes[0].startTime) return -1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (notes[mid].startTime === time) {
      const t = notes[mid].startTime - 1e-8;
      if (t < notes[0].startTime) {
        return 0;
      } else {
        return searchNotePosition(notes, t);
      }
    } else if (notes[mid].startTime < time) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return right;
}

function buttonEvent(state, buttonPos) {
  tapCount += 1;
  const t = currentTime;
  const looseTime = 0.1;
  const startTime = t - longestDuration - looseTime;
  const endTime = t + looseTime;
  let startPos = searchNotePosition(ns.notes, startTime);
  if (startPos < 0) startPos = 0;
  const endPos = searchNotePosition(ns.notes, endTime);
  const indexes = [];
  for (let i = startPos; i <= endPos; i++) {
    const note = ns.notes[i];
    if (!note.target) continue;
    if (note.button != buttonPos) continue;
    const rect = visualizer.svg.children[i];
    if (rect.classList.contains("fade")) continue;
    indexes.push(i);
  }
  let stateText = "MISS";
  indexes.forEach((index) => {
    const note = ns.notes[index];
    const rect = visualizer.svg.children[index];
    rect.classList.add("fade");
    const minTime = note.startTime - looseTime;
    const maxTime = note.endTime + looseTime;
    const avgRatio = (minTime + maxTime) / 2;
    if (avgRatio <= t && t <= maxTime) {
      stateText = "GREAT";
      rect.classList.add("fade");
      greatCount += 1;
    } else if (minTime <= t && t < avgRatio) {
      stateText = "PERFECT";
      rect.classList.add("fade");
      perfectCount += 1;
    }
  });
  switch (stateText) {
    case "PERFECT":
      state.textContent = stateText;
      state.className = "badge bg-primary";
      break;
    case "GREAT":
      state.textContent = stateText;
      state.className = "badge bg-success";
      break;
    case "MISS":
      state.className = "badge bg-danger";
      break;
  }
  setTimeout(() => {
    state.textContent = "MISS";
    state.className = "badge opacity-0";
  }, 200);
}

function setButtonEvent(state, button, buttonPos) {
  const ev = () => buttonEvent(state, buttonPos);
  button.ontouchstart = ev;
  button.onclick = ev;
  keyEvents.push(ev);
}

function changeButtons() {
  tapCount = perfectCount = greatCount = 0;
  keyEvents = [];
  const texts = Array.from("AWSEDRFTGYHUJIKOLP;@");
  const course = document.getElementById("courseOption").selectedIndex;
  const playPanel = document.getElementById("playPanel");
  playPanel.replaceChildren();
  for (let i = 0; i < course; i++) {
    const div = document.createElement("div");
    div.className = "w-100";
    const state = document.createElement("span");
    state.className = "badge opacity-0";
    state.textContent = "MISS";
    const button = document.createElement("button");
    button.className = "w-100 btn btn-light btn-tap";
    button.textContent = (course > 10) ? texts[i] : texts[i * 2];
    setButtonEvent(state, button, i);
    div.appendChild(button);
    div.appendChild(state);
    playPanel.appendChild(div);
  }
  document.removeEventListener("keydown", typeEvent);
  document.addEventListener("keydown", typeEvent);
  if (visualizer && ns) {
    changeVisualizerPositions(visualizer);
  }
}

function getAccuracy() {
  if (tapCount == 0) return 0;
  return (perfectCount + greatCount) / tapCount;
}

function scoring() {
  const accuracy = getAccuracy();
  const missCount = tapCount - perfectCount - greatCount;
  const perfectRate = Math.ceil(perfectCount / tapCount * 10000) / 100;
  const greatRate = Math.ceil(greatCount / tapCount * 10000) / 100;
  const missRate = Math.ceil(missCount / tapCount * 10000) / 100;
  const tapped = perfectCount * 2 + greatCount;
  const speed = parseInt(document.getElementById("speed").value);
  const course = document.getElementById("courseOption").selectedIndex;
  const score = parseInt(tapped * speed * course * accuracy);
  document.getElementById("perfectCount").textContent = perfectCount;
  document.getElementById("greatCount").textContent = greatCount;
  document.getElementById("missCount").textContent = missCount;
  document.getElementById("perfectRate").textContent = perfectRate + "%";
  document.getElementById("greatRate").textContent = greatRate + "%";
  document.getElementById("missRate").textContent = missRate + "%";
  document.getElementById("score").textContent = score;
  const title = document.getElementById("midiTitle").textContent;
  const composer = document.getElementById("composer").textContent;
  const info = `${title} ${composer}`;
  const text = encodeURIComponent(`Tip Tap Rhythm! ${info}: ${score}`);
  const url = "https://marmooo.github.com/tip-tap-rhythm/";
  const twitterUrl =
    `https://twitter.com/intent/tweet?text=${text}&url=${url}&hashtags=TipTapRhythm`;
  document.getElementById("twitter").href = twitterUrl;
}

function initQuery() {
  const query = new URLSearchParams();
  query.set("title", "When the Swallows Homeward Fly (Agathe)");
  query.set("composer", "Franz Wilhelm Abt");
  query.set("maintainer", "Stan Sanderson");
  query.set("license", "Public Domain");
  return query;
}

function loadLibraries(urls) {
  const promises = urls.map((url) => {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  });
  return Promise.all(promises);
}

const noteHeight = 30;
let controllerDisabled;
let keyEvents = [];
let colorful = true;
let currentTime = 0;
let currentScrollHeight;
let longestDuration;
let ns;
let nsCache;
let timer;
let player;
let visualizer;
let tapCount = 0;
let perfectCount = 0;
let greatCount = 0;
let firstRun = true;
loadConfig();
if (location.search) {
  loadMIDIFromUrlParams();
} else {
  const query = initQuery();
  loadMIDIFromUrl("abt.mid", query);
}
loadSoundFontList();

const scoreModal = new bootstrap.Modal("#scorePanel", {
  backdrop: "static",
  keyboard: false,
});

Module = {};
const JSSynthPromise = loadLibraries([
  "https://cdn.jsdelivr.net/npm/js-synthesizer@1.8.5/dist/js-synthesizer.min.js",
  "https://cdn.jsdelivr.net/npm/js-synthesizer@1.8.5/externals/libfluidsynth-2.3.0-with-libsndfile.min.js",
]);

document.getElementById("toggleDarkMode").onclick = toggleDarkMode;
document.getElementById("toggleColor").onclick = toggleRectColor;
document.ondragover = (e) => {
  e.preventDefault();
};
document.ondrop = dropFileEvent;
document.getElementById("play").onclick = play;
document.getElementById("pause").onclick = pause;
document.getElementById("speed").onchange = changeSpeedEvent;
document.getElementById("speedDown").onclick = speedDown;
document.getElementById("speedUp").onclick = speedUp;
document.getElementById("repeat").onclick = repeat;
document.getElementById("volumeOnOff").onclick = volumeOnOff;
document.getElementById("volumebar").onchange = changeVolumebar;
document.getElementById("seekbar").onchange = changeSeekbar;
document.getElementById("levelOption").onchange = changeLevel;
document.getElementById("inputMIDIFile").onchange = loadMIDIFileEvent;
document.getElementById("inputMIDIUrl").onchange = loadMIDIUrlEvent;
document.getElementById("inputSoundFontFile").onchange = loadSoundFontFileEvent;
document.getElementById("inputSoundFontUrl").onchange = loadSoundFontUrlEvent;
document.getElementById("soundfonts").onchange = changeConfig;
document.getElementById("courseOption").onchange = changeButtons;
window.addEventListener("resize", resize);
document.addEventListener("click", unlockAudio);
