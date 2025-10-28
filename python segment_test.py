# --- 3. 邏輯實作 --- (保持不變) ---

# -*- coding: utf-8 -*-
import json
import math
import traceback # 用於印出詳細錯誤

# --- 1. 設定 (高品質分句用) ---
PAUSE_THRESHOLD_MS = 500
LINGUISTIC_PAUSE_MS = 150
LINGUISTIC_MARKERS = [
    'です', 'でした', 'ます', 'ました', 'ません','ますか','ない',
    'だ','かな﻿','かしら',
    'ください',
    '。', '？', '！'
]
CONNECTIVE_PARTICLES_TO_MERGE = (
    'に', 'を', 'は', 'で', 'て', 'と', 'も', 'の' ,'本当','やっぱ','ども','お'
    # 備註：'が' 雖然也是助詞，但經常作為轉折詞獨立成句 (e.g., ...ですが、...)
    #      因此我們暫不將 'が' 放入強制合併列表
)

# // 【關鍵修正點】: 指定要讀取的檔案名稱
INPUT_FILENAME = "subtitle_data.json" # 您可以改成 .txt，只要內容是 JSON

# --- 3. 邏輯實作 (函式定義保持不變) ---

def ms_to_srt_time(ms):
    # ... (保持不變) ...
    seconds, milliseconds = divmod(ms, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}"

def clean_subtitle_events(events):
    # ... (保持不變) ...
    content_events = []
    for event in events:
        if 'segs' not in event or not event['segs']: continue
        is_newline_event = False
        if event.get('aAppend', 0) == 1 and len(event['segs']) == 1 and event['segs'][0].get('utf8', '') == "\\n": is_newline_event = True
        if not is_newline_event: content_events.append(event)
    cleaned_events = []
    total_events = len(content_events)
    if total_events == 0: return []
    for i in range(total_events):
        current_event = content_events[i]
        if 'tStartMs' not in current_event or 'dDurationMs' not in current_event:
            print(f"警告: 跳過格式錯誤 event: {current_event.get('segs', [])[0].get('utf8', 'N/A')}")
            continue
        start_ms = current_event['tStartMs']
        planned_end_ms = start_ms + current_event['dDurationMs']
        actual_end_ms = planned_end_ms
        if i + 1 < total_events:
            next_event = content_events[i+1]
            if 'tStartMs' in next_event:
                actual_end_ms = min(planned_end_ms, next_event['tStartMs'])
        full_text = ""
        segments_with_absolute_time = []
        for seg in current_event.get('segs', []):
            text = seg.get('utf8', '').replace('\n', '').strip()
            if text:
                full_text += text
                offset_ms = seg.get('tOffsetMs', 0)
                seg_start_ms = start_ms + offset_ms
                if seg_start_ms < actual_end_ms:
                    segments_with_absolute_time.append({'text': text, 'start_ms': seg_start_ms})
        if full_text:
            cleaned_events.append({'start_ms': start_ms, 'end_ms': actual_end_ms, 'text': full_text, 'segments': segments_with_absolute_time})
    return cleaned_events

def segment_blocks_by_internal_gaps(cleaned_events, pause_threshold_ms, linguistic_markers, linguistic_pause_ms):
    # ... (保持不變, 包含 Debug Log) ...
    final_sentences = []
    print("\n--- DEBUG: Phase 2 Segmentation Log ---")
    for event_idx, event in enumerate(cleaned_events):
        segments = event['segments']
        if not segments: continue
        print(f"\nDEBUG: Processing Block {event_idx} (Start: {event['start_ms']}ms)")
        current_sentence_segs_text = []
        current_sentence_start_ms = segments[0]['start_ms']
        for i in range(len(segments)):
            current_seg = segments[i]
            current_seg_text = current_seg['text']
            current_sentence_segs_text.append(current_seg_text)
            print(f"  DEBUG: Seg {i}: '{current_seg_text}' (Start: {current_seg['start_ms']}ms)")
            split_reason = None
            is_last_segment_in_block = (i == len(segments) - 1)
            if not is_last_segment_in_block:
                next_seg = segments[i+1]
                pause_duration = next_seg['start_ms'] - current_seg['start_ms']
                marker_found = any(marker in current_seg_text for marker in linguistic_markers)
                print(f"    DEBUG: Pause to next seg: {pause_duration}ms. Marker found: {marker_found}.")
                if pause_duration > pause_threshold_ms:
                    if len(current_sentence_segs_text) > 1:
                        split_reason = f"Time Gap ({pause_duration}ms)"
                        print(f"      DEBUG: Split Triggered! Reason: {split_reason}")
                    else: print("      DEBUG: Time Gap > Threshold, but ignored (first seg).")
                elif marker_found and pause_duration > linguistic_pause_ms:
                    if len(current_sentence_segs_text) > 1:
                        split_reason = f"Linguistic + Pause ({pause_duration}ms)"
                        print(f"      DEBUG: Split Triggered! Reason: {split_reason}")
                    else: print("      DEBUG: Linguistic + Pause > Threshold, but ignored (first seg).")
            elif is_last_segment_in_block:
                split_reason = "End of Block"
                print(f"    DEBUG: Last segment in block. Split Reason: {split_reason}")
            if split_reason:
                sentence_end_ms = event['end_ms'] if is_last_segment_in_block else segments[i+1]['start_ms']
                final_text = "".join(current_sentence_segs_text)
                if final_text:
                    sentence_data = {'text': final_text, 'start_ms': current_sentence_start_ms, 'end_ms': sentence_end_ms, 'reason': split_reason}
                    final_sentences.append(sentence_data)
                    print(f"  DEBUG: --> Output Sentence: '{final_text}' (Start: {current_sentence_start_ms}ms, End: {sentence_end_ms}ms, Reason: {split_reason})")
                current_sentence_segs_text = []
                if not is_last_segment_in_block: current_sentence_start_ms = segments[i+1]['start_ms']
    print("\n--- DEBUG: Phase 2 Segmentation Log End ---")
    return final_sentences


# // 【關鍵修正點】: 再次重寫階段三函式，使用真正迭代的合併邏輯
def post_process_merges(segmented_sentences, connective_markers):
    # // 功能: (階段三) 後處理。使用迭代方法合併 'End of Block' 或 '助詞結尾' 的句子
    # // input: 
    # //   - segmented_sentences: 階段二的結果
    # //   - connective_markers: 必須合併的結尾助詞 tuple
    # // output: 
    # //   合併後的 dict 列表
    
    if not segmented_sentences:
        return []

    print("\n--- DEBUG: Phase 3 Iterative Merge Log ---") # Log Start
    # 初始化最終列表
    final_merged = [] 
    
    for i, current in enumerate(segmented_sentences):
        current_text_cleaned = current['text'].strip()

        # 跳過空的句子
        if not current_text_cleaned:
            print(f"DEBUG: Skipping empty sentence at original index {i}.") # Log Skip Empty
            continue

        print(f"\nDEBUG: Processing sentence from index {i}: '{current_text_cleaned}' (Reason: {current['reason']})") # Log Processing

        # 如果 final_merged 是空的，直接加入當前句子
        if not final_merged:
            final_merged.append(current)
            print("  DEBUG: Added as first sentence.") # Log Add First
            continue

        # 取出 final_merged 中的最後一句 (即 previous)
        previous = final_merged[-1]
        previous_text_cleaned = previous['text'].strip()

        # --- 判斷 previous 是否需要與 current 合併 ---
        should_merge = False
        merge_trigger = "None"

        is_prev_end_of_block = previous['reason'] == 'End of Block'
        does_prev_end_with_particle = previous_text_cleaned and previous_text_cleaned.endswith(connective_markers)

        print(f"  DEBUG: Checking merge with previous in final list: '{previous_text_cleaned}'") # Log Check Previous
        print(f"    DEBUG: Previous Reason is 'End of Block'? {is_prev_end_of_block}")
        print(f"    DEBUG: Previous Ends with Particle ({connective_markers})? {does_prev_end_with_particle}")

        if is_prev_end_of_block:
            should_merge = True
            merge_trigger = "'End of Block'"
        elif does_prev_end_with_particle:
             should_merge = True
             merge_trigger = f"'Ends with Particle ({previous_text_cleaned[-1]})'"
             
        print(f"    DEBUG: Decision: Should Merge? {should_merge} (Trigger: {merge_trigger})") # Log Merge Decision

        # --- 執行合併或新增 ---
        if should_merge:
            merged_text = previous_text_cleaned + current_text_cleaned
            # 修改 final_merged 的最後一個元素 (in-place)
            final_merged[-1]['text'] = merged_text
            final_merged[-1]['end_ms'] = current['end_ms'] # 更新結束時間
            final_merged[-1]['reason'] = current['reason'] # 繼承當前句 (current) 的 reason
            print(f"  DEBUG: --> Merged. Updated last sentence in final_merged.") # Log Merge Action
            print(f"      New Text: '{merged_text}'")
            print(f"      New End Time: {current['end_ms']}ms")
            print(f"      New Reason: '{current['reason']}'")
        else:
            # 不需要合併，將 current 作為新句子加入 final_merged
            final_merged.append(current)
            print(f"  DEBUG: --> No Merge. Added current sentence as a new item.") # Log Add New

    # 最後清理一次所有合併後的文本，並過濾空字串
    final_merged = [s for s in final_merged if s['text'].strip()]
    for sentence in final_merged:
        sentence['text'] = sentence['text'].strip()
        
    print("\n--- DEBUG: Phase 3 Iterative Merge Log End ---") # Log End
    return final_merged

# --- 4. 執行與輸出 ---
try:
    # ... (讀取檔案的部分保持不變) ...
    print(f"正在讀取檔案: {INPUT_FILENAME}")
    with open(INPUT_FILENAME, 'r', encoding='utf-8') as f:
        data = json.load(f) 
    all_events = data.get("events", [])
    if not all_events:
        print("錯誤：在 JSON 數據中找不到 'events' 列表或列表為空。")
        exit() 

    # --- 階段一：清理 ---
    print("\n--- 階段一：清理後的句子區塊 (Events) ---")
    cleaned_blocks = clean_subtitle_events(all_events)
    print(f"階段一完成，清理出 {len(cleaned_blocks)} 個有效句子區塊。")

    # --- 階段二：高品質分句 ---
    print(f"\n--- 階段二：使用 {PAUSE_THRESHOLD_MS}ms 停頓 / {LINGUISTIC_PAUSE_MS}ms 語言停頓進行分句 ---")
    segmented_sentences = segment_blocks_by_internal_gaps(
        cleaned_blocks,
        PAUSE_THRESHOLD_MS,
        LINGUISTIC_MARKERS,
        LINGUISTIC_PAUSE_MS
    )
    print(f"階段二完成，切分出 {len(segmented_sentences)} 個原始句子。")

    # --- 階段三：合併 'End of Block' & 助詞結尾 (使用新迭代邏輯) ---
    print(f"\n--- 階段三：合併 'End of Block' & 助詞結尾 句子 (Iterative) ---")
    final_sentences = post_process_merges(
        segmented_sentences,
        CONNECTIVE_PARTICLES_TO_MERGE
    )
    print(f"階段三完成，合併後總句數: {len(final_sentences)}")
    print("\n")

    # --- 輸出格式 1：詳細格式 ---
    print("--- 輸出 1：詳細時間軸 ---")
    for i, sentence_data in enumerate(final_sentences):
        start_time = ms_to_srt_time(sentence_data['start_ms'])
        end_time = ms_to_srt_time(sentence_data['end_ms'])
        text = sentence_data['text']
        reason = sentence_data['reason']

        print(f"{i+1}. [{start_time} --> {end_time}]")
        print(f"   {text}  (Reason: {reason})")

    print("\n" + "="*30 + "\n")

    # --- 輸出格式 2：純文字列表 ---
    print("--- 輸出 2：純文字列表 (JSON 格式 - 緊密) ---")
    simple_text_list = [s['text'] for s in final_sentences]

    print(json.dumps(simple_text_list, ensure_ascii=False))

except FileNotFoundError:
    print(f"錯誤：找不到檔案 '{INPUT_FILENAME}'。請確認檔案存在於腳本相同的目錄下，或提供正確的路徑。")
except json.JSONDecodeError as e:
    print(f"錯誤：解析 JSON 檔案 '{INPUT_FILENAME}' 失敗。請檢查檔案內容是否為有效的 JSON 格式。")
    print(f"詳細錯誤: {e}")
except Exception as e:
    print(f"處理時發生未預期的錯誤: {e}")
    traceback.print_exc()