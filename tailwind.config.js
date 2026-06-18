/** @type {import('tailwindcss').Config} */
export default {
    darkMode: "class",
    content: [
        "./index.html",
        "./public/js/**/*.js",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            "colors": {
                "on-primary-fixed-variant": "#004395",
                "on-secondary-fixed": "#341100",
                "on-primary-fixed": "#001a42",
                "on-primary": "#002e6a",
                "on-secondary": "#552100",
                "surface-variant": "#2d3449",
                "outline-variant": "#424754",
                "surface-tint": "#adc6ff",
                "inverse-surface": "#dae2fd",
                "surface-container-lowest": "#060e20",
                "on-secondary-container": "#4a1c00",
                "surface-container-low": "#131b2e",
                "on-surface-variant": "#c2c6d6",
                "primary-container": "#4d8eff",
                "surface-container": "#171f33",
                "error-container": "#93000a",
                "surface": "#0b1326",
                "primary": "#adc6ff",
                "background": "#0b1326",
                "surface-dim": "#0b1326",
                "on-background": "#dae2fd",
                "primary-fixed": "#d8e2ff",
                "secondary": "#ffb690",
                "on-tertiary": "#003824",
                "inverse-on-surface": "#283044",
                "tertiary-fixed": "#6ffbbe",
                "outline": "#8c909f",
                "secondary-fixed": "#ffdbca",
                "on-primary-container": "#00285d",
                "surface-container-high": "#222a3d",
                "on-tertiary-container": "#00311f",
                "tertiary-fixed-dim": "#4edea3",
                "on-secondary-fixed-variant": "#783200",
                "secondary-fixed-dim": "#ffb690",
                "on-tertiary-fixed": "#002113",
                "inverse-primary": "#005ac2",
                "surface-bright": "#31394d",
                "primary-fixed-dim": "#adc6ff",
                "on-tertiary-fixed-variant": "#005236",
                "surface-container-highest": "#2d3449",
                "on-error": "#690005",
                "on-surface": "#dae2fd",
                "tertiary": "#4edea3",
                "tertiary-container": "#00a572",
                "secondary-container": "#ec6a06",
                "error": "#ffb4ab",
                "on-error-container": "#ffdad6"
            },
            "borderRadius": {
                "DEFAULT": "0.25rem",
                "lg": "0.5rem",
                "xl": "0.75rem",
                "2xl": "1rem",
                "full": "9999px"
            },
            "spacing": {
                "gutter": "24px",
                "inner-padding": "24px",
                "nav-width": "280px",
                "margin-page": "32px",
                "card-gap": "20px"
            },
            "fontFamily": {
                "headline-lg": ["Hanken Grotesk"],
                "display-lg": ["Hanken Grotesk"],
                "headline-lg-mobile": ["Hanken Grotesk"],
                "body-lg": ["Inter"],
                "headline-md": ["Hanken Grotesk"],
                "body-md": ["Inter"],
                "body-sm": ["Inter"],
                "label-md": ["JetBrains Mono"]
            },
            "fontSize": {
                "headline-lg": ["32px", { "lineHeight": "40px", "fontWeight": "600" }],
                "display-lg": ["48px", { "lineHeight": "56px", "letterSpacing": "-0.02em", "fontWeight": "700" }],
                "headline-lg-mobile": ["28px", { "lineHeight": "36px", "fontWeight": "600" }],
                "body-lg": ["18px", { "lineHeight": "28px", "fontWeight": "400" }],
                "headline-md": ["24px", { "lineHeight": "32px", "fontWeight": "600" }],
                "body-md": ["16px", { "lineHeight": "24px", "fontWeight": "400" }],
                "body-sm": ["14px", { "lineHeight": "20px", "fontWeight": "400" }],
                "label-md": ["12px", { "lineHeight": "16px", "letterSpacing": "0.05em", "fontWeight": "500" }]
            }
        }
    }
}
