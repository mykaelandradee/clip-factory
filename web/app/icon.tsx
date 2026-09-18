import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 16,
        background: "linear-gradient(135deg, #9d7cff 0%, #63e6c0 100%)",
        color: "#08080a",
        fontSize: 24,
        fontWeight: 800,
        fontFamily: "Arial",
      }}
    >
      CF
    </div>,
    size,
  );
}
