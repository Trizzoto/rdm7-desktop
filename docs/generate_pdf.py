"""Generate PDF from RDM7-Guide.md using reportlab."""
import re
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT = os.path.join(SCRIPT_DIR, "RDM7-Guide.md")
OUTPUT = os.path.join(SCRIPT_DIR, "RDM7-Visual-Designer-Guide.pdf")

# Colours
BG_DARK = HexColor("#111214")
TEXT_WHITE = HexColor("#e0e0e0")
TEXT_MUTED = HexColor("#999999")
ACCENT = HexColor("#3b82f6")
BORDER = HexColor("#2e2f34")
HEADER_BG = HexColor("#1a1b1e")
ROW_ALT = HexColor("#16171a")

def build_styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle("DocTitle", parent=styles["Title"], fontSize=22,
                              textColor=TEXT_WHITE, spaceAfter=6, alignment=TA_CENTER))
    styles.add(ParagraphStyle("H1", parent=styles["Heading1"], fontSize=16,
                              textColor=ACCENT, spaceBefore=20, spaceAfter=8,
                              borderPadding=(0, 0, 4, 0)))
    styles.add(ParagraphStyle("H2", parent=styles["Heading2"], fontSize=13,
                              textColor=TEXT_WHITE, spaceBefore=14, spaceAfter=6))
    styles.add(ParagraphStyle("H3", parent=styles["Heading3"], fontSize=11,
                              textColor=HexColor("#cccccc"), spaceBefore=10, spaceAfter=4))
    styles.add(ParagraphStyle("Body", parent=styles["Normal"], fontSize=9.5,
                              textColor=TEXT_MUTED, leading=14, spaceAfter=4))
    styles.add(ParagraphStyle("TableCell", parent=styles["Normal"], fontSize=8.5,
                              textColor=TEXT_MUTED, leading=11))
    styles.add(ParagraphStyle("TableHeader", parent=styles["Normal"], fontSize=8.5,
                              textColor=TEXT_WHITE, leading=11, fontName="Helvetica-Bold"))
    return styles

def parse_markdown(md_text, styles):
    """Simple markdown parser — handles headings, paragraphs, bold, tables, and HRs."""
    story = []
    lines = md_text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]

        # Horizontal rule
        if line.strip() == "---":
            story.append(Spacer(1, 6))
            story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER))
            story.append(Spacer(1, 6))
            i += 1
            continue

        # Headings
        if line.startswith("# ") and not line.startswith("## "):
            story.append(Paragraph(fmt(line[2:].strip()), styles["DocTitle"]))
            i += 1
            continue
        if line.startswith("## "):
            story.append(Spacer(1, 8))
            story.append(Paragraph(fmt(line[3:].strip()), styles["H1"]))
            i += 1
            continue
        if line.startswith("### "):
            story.append(Paragraph(fmt(line[4:].strip()), styles["H2"]))
            i += 1
            continue
        if line.startswith("#### "):
            story.append(Paragraph(fmt(line[5:].strip()), styles["H3"]))
            i += 1
            continue

        # Table
        if "|" in line and i + 1 < len(lines) and "---" in lines[i + 1]:
            table_lines = []
            while i < len(lines) and "|" in lines[i]:
                table_lines.append(lines[i])
                i += 1
            # Parse table
            rows = []
            for tl in table_lines:
                if "---" in tl:
                    continue
                cells = [c.strip() for c in tl.strip().strip("|").split("|")]
                rows.append(cells)
            if rows:
                story.append(Spacer(1, 4))
                story.append(build_table(rows, styles))
                story.append(Spacer(1, 4))
            continue

        # Blank line
        if not line.strip():
            i += 1
            continue

        # Regular paragraph (collect consecutive non-empty lines)
        para_lines = []
        while i < len(lines) and lines[i].strip() and not lines[i].startswith("#") and "|" not in lines[i] and lines[i].strip() != "---":
            para_lines.append(lines[i].strip())
            i += 1
        if para_lines:
            text = " ".join(para_lines)
            story.append(Paragraph(fmt(text), styles["Body"]))

    return story

def fmt(text):
    """Convert markdown inline formatting to reportlab XML."""
    # Bold
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    # Inline code
    text = re.sub(r'`(.+?)`', r'<font face="Courier" color="#3b82f6">\1</font>', text)
    # Degree symbol
    text = text.replace("&deg;", "\u00b0")
    # mdash
    text = text.replace("&mdash;", "\u2014")
    text = text.replace(" - ", " \u2014 ")
    return text

def build_table(rows, styles):
    """Build a reportlab Table from parsed rows."""
    if not rows:
        return Spacer(1, 1)
    header = rows[0]
    data_rows = rows[1:] if len(rows) > 1 else []

    col_count = len(header)
    available = A4[0] - 40 * mm
    col_widths = [available / col_count] * col_count

    table_data = [[Paragraph(fmt(c), styles["TableHeader"]) for c in header]]
    for row in data_rows:
        # Pad short rows
        while len(row) < col_count:
            row.append("")
        table_data.append([Paragraph(fmt(c), styles["TableCell"]) for c in row[:col_count]])

    t = Table(table_data, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), TEXT_WHITE),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]
    # Alternating row backgrounds
    for row_idx in range(1, len(table_data)):
        if row_idx % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, row_idx), (-1, row_idx), ROW_ALT))
    t.setStyle(TableStyle(style_cmds))
    return t

def main():
    with open(INPUT, "r", encoding="utf-8") as f:
        md = f.read()

    styles = build_styles()
    story = parse_markdown(md, styles)

    doc = SimpleDocTemplate(
        OUTPUT, pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=20 * mm, bottomMargin=20 * mm,
    )
    doc.build(story)
    print(f"PDF generated: {OUTPUT}")

if __name__ == "__main__":
    main()
