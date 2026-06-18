---
name: Lumina Glass
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#c2c6d6'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#8c909f'
  outline-variant: '#424754'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e6a'
  primary-container: '#4d8eff'
  on-primary-container: '#00285d'
  inverse-primary: '#005ac2'
  secondary: '#ffb690'
  on-secondary: '#552100'
  secondary-container: '#ec6a06'
  on-secondary-container: '#4a1c00'
  tertiary: '#4edea3'
  on-tertiary: '#003824'
  tertiary-container: '#00a572'
  on-tertiary-container: '#00311f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#ffdbca'
  secondary-fixed-dim: '#ffb690'
  on-secondary-fixed: '#341100'
  on-secondary-fixed-variant: '#783200'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  nav-width: 280px
  gutter: 24px
  margin-page: 32px
  card-gap: 20px
  inner-padding: 24px
---

## Brand & Style

This design system is built for a premium, high-efficiency assistant tailored for content creators. The personality is "The Sophisticated Architect"—organized, futuristic, and highly capable. It prioritizes clarity of data and workflow focus without sacrificing aesthetic appeal.

The style is **Glassmorphism with a Professional Edge**. It moves away from the flat, utilitarian look of the reference images toward a deeply layered interface. It utilizes a dark, immersive "Obsidian" environment where content containers feel like suspended panes of glass. This approach reduces visual cognitive load by using depth rather than heavy colors to establish hierarchy.

- **Visual Principles:** Depth via translucency, precision through 1px strokes, and focus through vibrant CTA accents.
- **Target Audience:** Content creators, YouTubers, and digital marketers who value tool quality as much as productivity.

## Colors

The palette is anchored in a deep, professional "Obsidian" dark mode. Instead of pure black, we use slate and charcoal tones to provide a more natural background for long-term usage.

- **Primary (Electric Blue):** Used for primary actions, progress indicators, and active navigation states.
- **Secondary (Sunset Orange):** Reserved specifically for high-conversion CTAs (e.g., "Generate Content") to create a heat-map effect against the cool background.
- **Neutral/Surface:** A range of slates (Slate-900 to Slate-800) used for the base environment and varying levels of card elevation.
- **Glass Accents:** Pure white at 5-10% opacity for surface fills, paired with a 15% opacity white border to create the "etched glass" look.

## Typography

The typography system focuses on high-precision legibility. **Hanken Grotesk** provides a sharp, modern feel for headlines, while **Inter** handles the heavy lifting of content generation and settings due to its exceptional readability in UI contexts. 

**JetBrains Mono** is introduced as a utility font for labels, metadata, and status indicators (like "Word Count" or "AI Status"), reinforcing the technical, "assistant" nature of the product.

For mobile, headlines scale down slightly to ensure that long content titles do not wrap awkwardly. All text on glass surfaces should maintain a high contrast ratio (minimum 4.5:1) against the blurred background.

## Layout & Spacing

The layout is defined by a **Vertical Split Configuration**. A fixed left-side navigation (280px) houses the workflow steps, allowing the main viewport to be dedicated to content creation.

The main content area utilizes a **Split-Card Layout**:
- **Left Column (Inputs):** Fixed-width or constrained container for configuration and AI prompts.
- **Right Column (Output/Preview):** Expansive area for generated text, scripts, or images.

On Tablet, the left navigation collapses into a rail or drawer. On Mobile, the layout reflows into a single-column stacked view where the "Settings/Inputs" are accessible via a bottom-sheet or a toggle header. We use a strictly 8px-based spacing system to ensure perfect alignment of delicate 1px borders.

## Elevation & Depth

Hierarchy is established through "Luminous Layering" rather than traditional heavy shadows.

1.  **Level 0 (Base):** Deep Slate background (#0F172A).
2.  **Level 1 (Navigation Rail):** A solid dark surface slightly lighter than base, no blur.
3.  **Level 2 (Main Cards):** Glassmorphic surfaces using `backdrop-filter: blur(12px)`. Fill is white at 4% opacity. Stroke is 1px white at 10% opacity.
4.  **Level 3 (Popovers/Modals):** High-intensity blur (24px) with a subtle "Ambient Glow"—a soft primary-colored shadow (Blue) with 10% opacity and 40px spread to simulate light passing through glass.

This system creates a "Stacking" mental model where the most interactive elements appear closest to the user.

## Shapes

The shape language is **Refined & Rounded**. Elements utilize a 0.5rem (8px) base radius which feels modern without appearing overly "bubbly."

- **Standard Elements (Buttons, Inputs):** 8px.
- **Container Cards:** 16px (rounded-lg) to create a clear "frame" for content.
- **Contextual Chips:** Pill-shaped (fully rounded) to distinguish them from actionable buttons.

## Components

### Buttons
- **Primary:** Gradient fill (Electric Blue to a slightly darker shade), white text, 1px inset border for a "pressed" look.
- **CTA (Generate):** Sunset Orange solid fill with high-contrast dark text. Includes a subtle "pulse" glow on hover.
- **Ghost:** Transparent fill, 1px white (15% opacity) border. Hover state increases border opacity to 40%.

### Input Fields & Dropdowns
Fields are dark-glass panes. Instead of a solid background, they use a 5% white tint. The focus state is marked by the 1px border changing to the Primary Blue and a very soft 4px blue outer glow.

### Split-Cards
A unique component for this system. A single 16px rounded card divided by a 1px vertical line. The left side handles configuration; the right side handles the AI "Canvas."

### Progress/Step Indicators
Located in the vertical nav. Active steps feature a vertical blue "light bar" on the far left and a subtle background highlight. Completed steps show a tertiary (Green) checkmark.

### AI Feedback Toast
Small, bottom-aligned glass notifications with a progress bar at the bottom to indicate "Generation in progress" or "Export complete."