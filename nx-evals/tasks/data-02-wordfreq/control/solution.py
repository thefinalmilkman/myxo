def word_freq(text):
    freq = {}
    if text == "":
        return freq
    for w in text.split(" "):
        freq[w] = freq.get(w, 0) + 1
    return freq
