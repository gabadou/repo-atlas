// Repo atlas, the map. Reads the data embedded in the page, builds each part, and runs the frame loop.
// Each part gets `app` and finds the others on it when it needs them.
import { analyse } from "./graph.js";
import { buildTree, layout } from "./city.js";
import { createPalette, readColours } from "./colours.js";
import { createScene } from "./scene.js";
import { createCity3d } from "./city3d.js";
import { createLines } from "./lines.js";
import { createPainter } from "./paint.js";
import { createNavigation } from "./navigation.js";
import { createPointer } from "./pointer.js";
import { createLists } from "./lists.js";
import { createPanel } from "./panel.js";
import { createSummary } from "./summary.js";
import { createSidebar } from "./sidebar.js";
import { initPicker } from "./picker.js";
import { createSheets } from "./sheet.js";

const data = JSON.parse(document.getElementById("atlas-data").textContent);
const tree = buildTree(data.files);
const app = {
  data,
  tree,
  G: analyse(data), // who uses whom, cycles
  city: layout(data, tree), // where every plate and building goes
  N: data.files.length,
  state: { mode: "area", selected: null, lines: true, packages: true, labels: true },
};

app.C = readColours();
app.palette = createPalette(app);
app.lists = createLists(data);
app.view = createScene(app);
app.city3d = createCity3d(app);
app.lines = createLines(app);
app.painter = createPainter(app);
app.nav = createNavigation(app);
app.summary = createSummary(app);
app.panel = createPanel(app);
app.pointer = createPointer(app);
app.picker = initPicker();
app.sidebar = createSidebar(app);
app.sheets = createSheets(app);

// The theme switched: every colour is read again from the tokens.
app.applyTheme = () => {
  app.C = readColours();
  app.view.applyTheme();
  app.lines.paintAll();
  app.painter.recolour();
  app.city3d.paintLabels();
  app.sidebar.renderLegend();
  app.painter.paint();
};

app.lines.paintAll();
app.painter.recolour();
app.painter.paint();
app.view.resize();
app.nav.home(true);

app.view.renderer.setAnimationLoop((now) => {
  app.nav.update(now);
  app.pointer.update();
  app.view.renderer.render(app.view.scene, app.view.camera);
  app.city3d.placeFloating();
});

// For tests and the curious: window.__atlas.select({ kind: "file", i: 0 }, true)
window.__atlas = {
  select: app.panel.select, selectFile: app.panel.selectFile, selectDir: app.panel.selectDir, state: app.state, home: app.nav.home,
  camera: app.view.camera, controls: app.nav.controls,
};
