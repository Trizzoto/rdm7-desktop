# RDM Studio - User Guide

---

## 1. Getting Started

### What is RDM Studio?

RDM Studio (formerly the RDM-7 Visual Designer) is a desktop application for designing custom automotive dashboard and gauge cluster layouts for RDM-7 display hardware. Build dashboards visually, map live CAN bus signals, and push layouts directly to your device.

### Supported Displays

| Display | Resolution | Shape |
|---------|-----------|-------|
| RDM-7 inch | 800 x 480 | Rectangle |
| 4 inch Round | 720 x 720 | Circle |
| 3 inch Round | 800 x 800 | Circle |
| 2.8 inch Round | 480 x 480 | Circle |

### First Launch

When you open the app for the first time, a **Getting Started Tour** will walk you through the main areas of the interface. You can replay it anytime from the menu.

The app works in **offline mode** by default - you can design layouts without a device connected. Connect later to push your work to the RDM-7.

---

## 2. The Editor

### Layout

The editor is divided into three main areas:

- **Toolbar** (top) - Display size selector, screen mode (Dashboard / Splash), layout selector, connection controls, and Save button.
- **Canvas** (centre) - The live preview of your dashboard. This is where you drag, position, and resize widgets.
- **Right Sidebar** - Three tabs:
  - **Widgets** - Palette of available widget types to drag onto the canvas.
  - **Properties** - Inspector for the selected widget's configuration.
  - **Layers** - Z-order list of all widgets on the layout.

### Canvas Controls

| Action | How |
|--------|-----|
| **Move widget** | Click and drag |
| **Resize widget** | Select, then drag a corner or edge handle |
| **Multi-select** | Ctrl+Click widgets, or drag a selection box on empty canvas |
| **Pan canvas** | Hold Space + drag |
| **Zoom** | Ctrl + scroll wheel |
| **Zoom to fit** | Click the reset button in the toolbar |
| **Clone widget** | Alt + drag |
| **Nudge 1px** | Arrow keys |
| **Nudge 10px** | Shift + Arrow keys |

### Alignment Tools

The alignment bar appears above the canvas:

- **Align Left / Centre / Right** - Snap selected widgets horizontally.
- **Align Top / Middle / Bottom** - Snap selected widgets vertically.
- **Distribute X / Y** - Evenly space 3 or more selected widgets.

### Smart Snapping

When dragging widgets, guide lines appear automatically when edges or centres align with other widgets. The snap threshold is 10px.

### Toolbar Toggles

- **Bezel** - Show/hide the device frame around the canvas.
- **Widgets** - Show/hide widget selection borders (toggle off for a clean preview).
- **Crosshair** - Show/hide alignment crosshair guides.
- **Sim** - Enable signal simulation for testing without a device.

---

## 3. Building a Dashboard

### Adding Widgets

1. Open the **Widgets** tab in the right sidebar.
2. Drag a widget type onto the canvas.
3. Release to place it. The widget appears at the drop position.

### Configuring a Widget

1. Click a widget to select it.
2. Switch to the **Properties** tab.
3. Adjust fields like label, font, colours, decimals, min/max values, and more.
4. Changes appear in the live canvas preview immediately.

### Widget Types

#### Display Widgets

| Widget | Purpose |
|--------|---------|
| **Panel** | Numeric value readout with label and unit. Supports alert colour thresholds. |
| **Bar Graph** | Horizontal fill bar with min/max scaling and colour alerts. |
| **RPM Bar** | Full-width RPM bar with redline marker and limiter flash effects (7 modes). |
| **Meter** | Circular analogue gauge with needle, tick marks, and scale labels. |
| **Arc** | Partial arc gauge with fill animation. Supports image overlays for custom designs. |
| **Shift Light** | LED strip that fills with RPM. Configurable LED count, colours, and flash point. |
| **Text / Value** | Static text label or live signal value. Custom font, colour, and rotation. |
| **Gear Display** | Shows the current gear selection. |

#### Visual Widgets

| Widget | Purpose |
|--------|---------|
| **Image** | Display a PNG/JPG from your image library. Scale 10-200%, tint overlay. |
| **Shape Panel** | Decorative rectangle with background, border, corner radius, and shadow. |
| **Indicator** | Turn signal indicator (left/right) with animation. |
| **Warning Light** | Circular alert icon. Activates when a signal crosses a threshold. |

#### Interactive Widgets (CAN Transmit)

| Widget | Purpose |
|--------|---------|
| **Toggle Switch** | Tap to send a CAN value. Supports latching and custom graphics. |
| **Button** | Momentary or latching CAN-transmit button. Configurable TX rate and colours. |

### Conditional Rules

Most widgets support **rules** - automatic appearance changes when a signal meets a condition.

**Example**: Turn a panel's background red when coolant temperature exceeds 100 degrees.

To add a rule:
1. Select the widget.
2. Open Properties, scroll to **Rules**.
3. Click **Add Rule**.
4. Set the condition (signal, operator, threshold).
5. Set the override (which property changes, and to what value).

Rules are evaluated in real-time on the device.

### Layer Order

Widgets are drawn in layer order - widgets higher in the Layers tab appear on top. To change order:
- **Right-click** a widget and choose **Bring Forward** or **Send Back**.
- Or drag widgets in the **Layers** tab to reorder.

---

## 4. Signals & Data

### What Are Signals?

Signals map CAN bus messages to values your widgets display. Each signal defines how to extract a number from a raw CAN frame:

| Field | Description |
|-------|-------------|
| **Name** | Human-readable identifier (e.g. "RPM", "COOLANT_TEMP") |
| **CAN ID** | Message identifier (hex, e.g. 0x520) |
| **Bit Start** | Position of the first bit in the message (0-63) |
| **Bit Length** | Number of bits to extract (1-32) |
| **Scale** | Multiply raw value by this (e.g. 0.1 means raw 1000 = display 100.0) |
| **Offset** | Add this after scaling |
| **Endian** | Byte order - Little Endian (Intel) or Big Endian (Motorola) |
| **Signed** | Whether the value can be negative |

### ECU Presets

The fastest way to get started is with an ECU preset:

1. Select your ECU from the dropdown in the toolbar (e.g. **MaxxECU**).
2. All standard signals are loaded automatically.
3. When configuring a widget, pick a signal from the dropdown - they're pre-configured with the correct CAN IDs, bit positions, and scaling.

### DBC File Import

If your ECU provides a .dbc file (CAN database):

1. Open the Signal Manager (Ctrl+Shift+S).
2. Click **Import DBC**.
3. Select your .dbc file.
4. Signals are extracted and added to your layout.

### Custom Signals

For signals not covered by presets:

1. Open the Signal Manager (Ctrl+Shift+S).
2. Click **Add Signal**.
3. Fill in the CAN ID, bit position, length, scale, and offset.
4. The signal is now available in widget property dropdowns.

### Assigning Signals to Widgets

1. Select a widget on the canvas.
2. Open the **Properties** tab.
3. Find the **Signal** field.
4. Pick from the dropdown or type to search.

---

## 5. Advanced Features

### Splash Screens

The splash screen is displayed briefly when the RDM-7 boots up.

1. Switch to **Splash Screen** mode using the dropdown in the toolbar.
2. A default splash with the RDM logo is provided.
3. Add images, text, and shapes - the same widget tools apply.
4. Save to push the splash to the device.
5. Enable **Fade** for a smooth transition from splash to dashboard.

### Signal Simulation

Test your layout without a connected device:

1. Click **Sim** in the toolbar to enable simulation.
2. Click the gear icon next to it for simulation settings.
3. Simulated values animate across your widgets so you can verify thresholds, colours, and behaviour.

### Images & Fonts

Upload custom images and fonts via the **Storage Manager** (accessible from the menu):

- **Images**: PNG or JPG files. Used in Image widgets, gauge backgrounds, needle overlays.
- **Fonts**: TTF files. Used in Text, Panel, and other widgets with text.

### Data Logger

Record live CAN signal data:

1. Open **Data Logger** from the menu.
2. Click **Start** to begin recording.
3. Click **Stop** when done.
4. Download the CSV file for analysis in a spreadsheet.

### Fuel Calibration

Calibrate your fuel tank level sensor:

1. Open **Fuel Calibration** from the menu.
2. With the tank empty, click **Set Empty**.
3. Fill the tank, then click **Set Full**.
4. The RDM-7 interpolates between these reference points.

---

## 6. Device Management

### Connecting to Your Device

| Mode | Setup | Best For |
|------|-------|----------|
| **USB Serial** | Plug in USB cable. Port auto-detected. | File transfers, firmware updates |
| **WiFi** | Enter device IP from the connection dropdown. | Live preview, data logging |
| **ESP32 Hotspot** | Connect PC to the RDM-7's WiFi network. | Track-side use, no router needed |
| **Offline** | No connection needed. | Designing without hardware |

### Saving to Device

When connected, **Save** (Ctrl+S) pushes your layout directly to the device's internal storage. The display updates in real time.

### Storage Manager

Open from the menu to manage files on the device:

- **Internal Storage** - Layouts, images, and fonts stored on the RDM-7.
- **SD Card** - Backup and transfer. Copy files between internal and SD card.
- View storage usage and free space.

### Firmware Updates (OTA)

1. Open the menu and select **Update Firmware (OTA)**.
2. The app checks for the latest firmware version.
3. Follow the prompts to download and flash the update over USB or WiFi.

### Import / Export Layouts

- **Export Layout** - Saves a .rdm file to your computer for sharing or backup.
- **Import Layout** - Load a .rdm file into the editor (Ctrl+O).

---

## 7. Quick Reference

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+S | Save layout |
| Ctrl+O | Import RDM file |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+C / Ctrl+V | Copy / Paste widget |
| Ctrl+D | Duplicate widget |
| Ctrl+Shift+C / V | Copy / Paste style |
| Delete | Delete widget |
| Arrow keys | Nudge 1px |
| Shift+Arrows | Nudge 10px |
| Ctrl+Scroll | Zoom in/out |
| Space+Drag | Pan canvas |
| Alt+Drag | Clone widget |
| Ctrl+Click | Multi-select |
| Right-Click | Context menu |
| Ctrl+Shift+S | Signal Manager |

### Display Presets

| Preset | Resolution | Shape |
|--------|-----------|-------|
| RDM-7 inch | 800 x 480 | Rectangle |
| 4 inch Round | 720 x 720 | Circle |
| 3 inch Round | 800 x 800 | Circle |
| 2.8 inch Round | 480 x 480 | Circle |

### Troubleshooting

| Problem | Solution |
|---------|----------|
| Can't connect via USB | Check the COM port is correct. Try unplugging and replugging the cable. |
| Can't connect via WiFi | Verify the IP address. Ensure your PC and the RDM-7 are on the same network. |
| Widgets not updating | Check that signals are assigned and the device is connected. |
| Layout looks different on device | Ensure the screen preset matches your physical display. |
| SD card not detected | Check the card is inserted and formatted as FAT32. |
