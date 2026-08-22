import './Button.css';

/**
 * Button component stories
 * Reusable button variants used throughout ZE-POS
 */

// Primary button - main action
export const Primary = {
  render: () => `
    <button class="btn btn-primary">Primary Action</button>
  `,
  args: {
    children: 'Primary Action',
  },
};

// Secondary/outline button
export const Outline = {
  render: () => `
    <button class="btn btn-outline">Outline Button</button>
  `,
};

// Ghost button - subtle action
export const Ghost = {
  render: () => `
    <button class="btn btn-ghost">Ghost Button</button>
  `,
};

// Danger button - destructive actions
export const Danger = {
  render: () => `
    <button class="btn btn-danger">Delete</button>
  `,
};

// Success button - positive actions
export const Success = {
  render: () => `
    <button class="btn btn-success">Complete Order</button>
  `,
};

// Small button variant
export const Small = {
  render: () => `
    <button class="btn btn-primary btn-sm">Small Button</button>
  `,
};

// Large button variant
export const Large = {
  render: () => `
    <button class="btn btn-primary" style="padding: 16px 32px; font-size: 1.1rem;">Large Button</button>
  `,
};

// Disabled state
export const Disabled = {
  render: () => `
    <button class="btn btn-primary" disabled>Disabled</button>
  `,
};

// Button group
export const ButtonGroup = {
  render: () => `
    <div class="btn-group" style="display: flex; gap: 8px;">
      <button class="btn btn-outline">Cancel</button>
      <button class="btn btn-primary">Save</button>
    </div>
  `,
};

// Button with icon
export const WithIcon = {
  render: () => `
    <button class="btn btn-primary">
      <span style="margin-right: 8px;">🛒</span>
      Add to Cart
    </button>
  `,
};

// Complete order button (POS specific)
export const CompleteOrder = {
  render: () => `
    <button class="btn-complete-order">Complete Order</button>
  `,
};

// Split bill button (POS specific)
export const SplitBill = {
  render: () => `
    <button class="btn-split-bill">✂️ Split</button>
  `,
};

// All variants showcase
export const AllVariants = {
  render: () => `
    <div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: center;">
      <button class="btn btn-primary">Primary</button>
      <button class="btn btn-outline">Outline</button>
      <button class="btn btn-ghost">Ghost</button>
      <button class="btn btn-danger">Danger</button>
      <button class="btn btn-success">Success</button>
      <button class="btn btn-info">Info</button>
    </div>
  `,
};

// All sizes showcase
export const AllSizes = {
  render: () => `
    <div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: center;">
      <button class="btn btn-primary btn-sm">Small</button>
      <button class="btn btn-primary">Default</button>
      <button class="btn btn-primary" style="padding: 14px 28px; font-size: 1.05rem;">Large</button>
    </div>
  `,
};