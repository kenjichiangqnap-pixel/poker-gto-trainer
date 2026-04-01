"""
Analyze Facing RFI pages (4-8) and Facing 3-bet pages (9-14).
Reuses the grid analysis from analyze_charts3.py.
"""
import os, sys
from PIL import Image
import numpy as np

RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2']
IMG_DIR = r'C:\Users\kenji412\Documents\kenji_ai_test\poker-gto-trainer\pdf_pages'

HAND_RANKINGS = [
  'AA','KK','QQ','JJ','AKs','TT','AQs','AKo','AJs','KQs',
  '99','ATs','KJs','AQo','QJs','KTs','88','A9s','JTs','KQo',
  'A8s','K9s','T9s','QTs','A7s','77','A5s','A6s','A4s','J9s',
  'AJo','Q9s','A3s','98s','KJo','66','A2s','K8s','T8s','87s',
  'QJo','ATo','K7s','97s','76s','55','KTo','K6s','65s','J8s',
  '86s','A9o','K5s','54s','Q8s','75s','44','K4s','T7s','96s',
  'J7s','QTo','A8o','K3s','64s','85s','33','K2s','Q7s','53s',
  'J9o','Q6s','22','43s','J6s','63s','T6s','T9o','A7o','A6o',
  'Q5s','T5s','98o','A5o','95s','Q4s','J5s','84s','52s','42s',
  'K9o','A4o','Q3s','87o','J8o','A3o','Q2s','K8o','T8o','JTo',
  '97o','76o','A2o','Q9o','J4s','65o','J3s','86o','T4s','J2s',
  '54o','K7o','96o','T3s','75o','T2s','64o','94s','93s','K6o',
  '85o','92s','53o','Q8o','K5o','83s','74s','73s','J7o','43o',
  'T7o','K4o','82s','72s','Q7o','74o','K3o','Q6o','63o','62s',
  '32s','K2o','J6o','95o','T6o','Q5o','84o','52o','42o','J5o',
  'Q4o','73o','Q3o','62o','T5o','J4o','32o','Q2o','J3o','T4o',
  'J2o','94o','93o','T3o','92o','T2o','83o','82o','72o'
]

def grid_to_hand(row, col):
    if row == col: return RANKS[row] + RANKS[col]
    if row < col: return RANKS[row] + RANKS[col] + 's'
    return RANKS[col] + RANKS[row] + 'o'

def is_colored(r, g, b):
    r, g, b = int(r), int(g), int(b)
    mx = max(r, g, b)
    mn = min(r, g, b)
    if mx > 235 and mn > 235: return False
    if mx < 40: return False
    if mx < 80 and (mx - mn) < 20: return False
    if (mx - mn) > 25: return True
    if mx > 120 and mn > 80: return True
    return False

def classify_action(r, g, b):
    r, g, b = int(r), int(g), int(b)
    mx = max(r, g, b)
    mn = min(r, g, b)
    sat = mx - mn
    
    if mx > 220 and mn > 200: return 'fold'
    if mx < 50: return 'unknown'
    if sat < 30:
        if mx > 160: return 'fold'
        return 'unknown'
    
    if r >= g and r >= b:
        return 'raise'
    elif g >= r and g >= b:
        return 'call'
    else:
        return 'call'

def analyze_chart_region(arr, x1, x2, y1, y2):
    region = arr[y1:y2, x1:x2]
    h, w = region.shape[:2]
    
    cmask = np.zeros((h, w), dtype=bool)
    for y in range(h):
        for x in range(w):
            cmask[y, x] = is_colored(region[y,x,0], region[y,x,1], region[y,x,2])
    
    col_density = cmask.sum(axis=0)
    row_density = cmask.sum(axis=1)
    
    col_thresh = h * 0.12
    row_thresh = w * 0.12
    
    active_cols = np.where(col_density > col_thresh)[0]
    active_rows = np.where(row_density > row_thresh)[0]
    
    if len(active_cols) < 10 or len(active_rows) < 10:
        return None
    
    gx_local = active_cols[0]
    gx_end = active_cols[-1]
    gy_local = active_rows[0]
    gy_end = active_rows[-1]
    
    col_profile = cmask[gy_local:gy_end, gx_local:gx_end].sum(axis=0)
    row_profile = cmask[gy_local:gy_end, gx_local:gx_end].sum(axis=1)
    
    def find_cell_centers(profile, n_cells=13):
        avg = profile.mean()
        threshold = avg * 0.3
        cell_regions = []
        in_cell = False
        start = 0
        for i, v in enumerate(profile):
            if v > threshold and not in_cell:
                start = i
                in_cell = True
            elif (v <= threshold or i == len(profile)-1) and in_cell:
                end = i if v <= threshold else i + 1
                if end - start > 3:
                    cell_regions.append((start, end))
                in_cell = False
        if len(cell_regions) >= n_cells - 1:
            return [(s + e) // 2 for s, e in cell_regions[:n_cells]]
        cell_size = len(profile) / n_cells
        return [int((i + 0.5) * cell_size) for i in range(n_cells)]
    
    col_centers = find_cell_centers(col_profile)
    row_centers = find_cell_centers(row_profile)
    
    results = {}
    abs_gx = x1 + gx_local
    abs_gy = y1 + gy_local
    
    for ri, ry in enumerate(row_centers):
        for ci, cx_val in enumerate(col_centers):
            if ri >= 13 or ci >= 13:
                continue
            hand = grid_to_hand(ri, ci)
            sample_x = abs_gx + cx_val
            sample_y = abs_gy + ry
            
            r_sum, g_sum, b_sum, count = 0, 0, 0, 0
            for dy in range(-3, 4):
                for dx in range(-3, 4):
                    py = sample_y + dy
                    px = sample_x + dx
                    if 0 <= py < arr.shape[0] and 0 <= px < arr.shape[1]:
                        pr, pg, pb = int(arr[py,px,0]), int(arr[py,px,1]), int(arr[py,px,2])
                        if max(pr, pg, pb) > 50:
                            r_sum += pr; g_sum += pg; b_sum += pb; count += 1
            
            if count > 0:
                results[hand] = classify_action(r_sum//count, g_sum//count, b_sum//count)
            else:
                results[hand] = 'fold'
    
    return results

def summarize(label, results):
    if results is None:
        print(f"  {label}: NOT DETECTED")
        return
    
    raise_h = sorted([h for h in results if results[h] == 'raise'],
                     key=lambda h: HAND_RANKINGS.index(h) if h in HAND_RANKINGS else 999)
    call_h = sorted([h for h in results if results[h] == 'call'],
                    key=lambda h: HAND_RANKINGS.index(h) if h in HAND_RANKINGS else 999)
    
    rc = len(raise_h)
    cc = len(call_h)
    total = rc + cc
    
    print(f"  {label}: raise={rc}({rc/169*100:.0f}%) call={cc}({cc/169*100:.0f}%) total={total}({total/169*100:.0f}%)")
    if raise_h:
        print(f"    Raise: {', '.join(raise_h[:25])}{'...' if len(raise_h) > 25 else ''}")
    if call_h:
        print(f"    Call: {', '.join(call_h[:25])}{'...' if len(call_h) > 25 else ''}")

# ============ FACING RFI PAGES ============

# Page 4: Facing RFI EP/MP
# UTG+1 vs UTG, UTG+2 vs UTG/UTG+1, LJ vs UTG/UTG+1, LJ vs UTG+2
# HJ vs UTG, HJ vs UTG+1, HJ vs UTG+2, HJ vs LJ
print("\n" + "=" * 70)
print("PAGE 4: Facing RFI — EP/MP")
print("=" * 70)

img4 = Image.open(os.path.join(IMG_DIR, 'page_4.png'))
arr4 = np.array(img4)
h4, w4 = arr4.shape[:2]
print(f"  Dimensions: {w4}x{h4}")

# 2x4 layout
col_ranges = [(30, 540), (560, 1080), (1100, 1620), (1640, 2170)]
row1 = (50, 750)
row2 = (770, 1600)
names_r1 = ['UTG+1 vs UTG', 'UTG+2 vs UTG/UTG+1', 'LJ vs UTG/UTG+1', 'LJ vs UTG+2']
names_r2 = ['HJ vs UTG', 'HJ vs UTG+1', 'HJ vs UTG+2', 'HJ vs LJ']

for cidx, (x1, x2) in enumerate(col_ranges):
    r = analyze_chart_region(arr4, x1, x2, row1[0], row1[1])
    summarize(names_r1[cidx], r)
for cidx, (x1, x2) in enumerate(col_ranges):
    r = analyze_chart_region(arr4, x1, x2, row2[0], row2[1])
    summarize(names_r2[cidx], r)

# Page 5: Facing RFI CO
print("\n" + "=" * 70)
print("PAGE 5: Facing RFI — CO")
print("=" * 70)

img5 = Image.open(os.path.join(IMG_DIR, 'page_5.png'))
arr5 = np.array(img5)
names5 = ['CO vs UTG/UTG+1', 'CO vs UTG+2', 'CO vs LJ', 'CO vs HJ']
# Likely single row of 4 charts
for cidx, (x1, x2) in enumerate(col_ranges):
    r = analyze_chart_region(arr5, x1, x2, 50, 1600)
    summarize(names5[cidx], r)

# Page 6: Facing RFI BTN
print("\n" + "=" * 70)
print("PAGE 6: Facing RFI — Button")
print("=" * 70)

img6 = Image.open(os.path.join(IMG_DIR, 'page_6.png'))
arr6 = np.array(img6)
names6_r1 = ['BTN vs UTG', 'BTN vs UTG+1', 'BTN vs UTG+2', None]
names6_r2 = [None, 'BTN vs LJ', 'BTN vs HJ', 'BTN vs CO']

for cidx, (x1, x2) in enumerate(col_ranges):
    if names6_r1[cidx]:
        r = analyze_chart_region(arr6, x1, x2, 50, 750)
        summarize(names6_r1[cidx], r)

for cidx, (x1, x2) in enumerate(col_ranges):
    if names6_r2[cidx]:
        r = analyze_chart_region(arr6, x1, x2, 770, 1600)
        summarize(names6_r2[cidx], r)

# Page 7: Facing RFI SB
print("\n" + "=" * 70)
print("PAGE 7: Facing RFI — Small Blind")
print("=" * 70)

img7 = Image.open(os.path.join(IMG_DIR, 'page_7.png'))
arr7 = np.array(img7)
names7_r1 = ['SB vs UTG/UTG+1', 'SB vs UTG+2', 'SB vs LJ', None]
names7_r2 = [None, 'SB vs HJ', 'SB vs CO', 'SB vs BTN']

for cidx, (x1, x2) in enumerate(col_ranges):
    if names7_r1[cidx]:
        r = analyze_chart_region(arr7, x1, x2, 50, 750)
        summarize(names7_r1[cidx], r)
for cidx, (x1, x2) in enumerate(col_ranges):
    if names7_r2[cidx]:
        r = analyze_chart_region(arr7, x1, x2, 770, 1600)
        summarize(names7_r2[cidx], r)

# Page 8: Facing RFI BB
print("\n" + "=" * 70)
print("PAGE 8: Facing RFI — Big Blind")
print("=" * 70)

img8 = Image.open(os.path.join(IMG_DIR, 'page_8.png'))
arr8 = np.array(img8)
names8_r1 = ['BB vs UTG/UTG+1', 'BB vs UTG+2', 'BB vs LJ', 'BB vs HJ']
names8_r2 = [None, 'BB vs CO', 'BB vs BTN', 'BB vs SB']

for cidx, (x1, x2) in enumerate(col_ranges):
    if names8_r1[cidx]:
        r = analyze_chart_region(arr8, x1, x2, 50, 750)
        summarize(names8_r1[cidx], r)
for cidx, (x1, x2) in enumerate(col_ranges):
    if names8_r2[cidx]:
        r = analyze_chart_region(arr8, x1, x2, 770, 1600)
        summarize(names8_r2[cidx], r)

# ============ FACING 3-BET PAGES ============
# Page 9: UTG RFI vs 3bet
print("\n" + "=" * 70)
print("PAGE 9: UTG RFI vs 3-bet")
print("=" * 70)

img9 = Image.open(os.path.join(IMG_DIR, 'page_9.png'))
arr9 = np.array(img9)
names9_r1 = ['UTG vs UTG+1 3bet', 'UTG vs UTG+2 3bet', 'UTG vs LJ 3bet', 'UTG vs HJ 3bet']
names9_r2 = ['UTG vs CO/BTN 3bet', 'UTG vs SB/BB 3bet', None, None]

for cidx, (x1, x2) in enumerate(col_ranges):
    r = analyze_chart_region(arr9, x1, x2, 50, 750)
    summarize(names9_r1[cidx], r)
for cidx, (x1, x2) in enumerate(col_ranges[:2]):
    r = analyze_chart_region(arr9, x1, x2, 770, 1600)
    summarize(names9_r2[cidx], r)

# Page 13: HJ/CO RFI vs 3bet (most relevant for 6-max)
print("\n" + "=" * 70)
print("PAGE 13: HJ/CO RFI vs 3-bet")
print("=" * 70)

img13 = Image.open(os.path.join(IMG_DIR, 'page_13.png'))
arr13 = np.array(img13)
names13_r1 = ['HJ vs CO 3bet', 'HJ vs BTN 3bet', 'HJ vs SB 3bet', 'HJ vs BB 3bet']
names13_r2 = ['CO vs BTN/SB 3bet', 'CO vs BB 3bet', None, None]

for cidx, (x1, x2) in enumerate(col_ranges):
    r = analyze_chart_region(arr13, x1, x2, 50, 750)
    summarize(names13_r1[cidx], r)
for cidx, (x1, x2) in enumerate(col_ranges[:2]):
    r = analyze_chart_region(arr13, x1, x2, 770, 1600)
    summarize(names13_r2[cidx], r)

# Page 14: BTN/SB RFI vs 3bet
print("\n" + "=" * 70)
print("PAGE 14: BTN/SB RFI vs 3-bet")
print("=" * 70)

img14 = Image.open(os.path.join(IMG_DIR, 'page_14.png'))
arr14 = np.array(img14)
names14 = ['BTN vs SB/BB 3bet', 'SB RFI vs BB 3bet', 'SB Limp vs BB Raise']

for cidx, (x1, x2) in enumerate(col_ranges[:3]):
    r = analyze_chart_region(arr14, x1, x2, 50, 1600)
    summarize(names14[cidx], r)
