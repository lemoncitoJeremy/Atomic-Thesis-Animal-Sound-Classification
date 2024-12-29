import numpy as np
import librosa
import tensorflow as tf
import socket
from pathlib import Path
import argparse
from scipy.signal import butter, lfilter

# Constants
DATA_SOURCE = Path("../server/uploads/")
CLASS_LABELS = ["non", "frog", "bat"]
SAMPLE_RATE = 48000
TARGET_DURATION = 5.0
TARGET_SAMPLES = int(TARGET_DURATION * SAMPLE_RATE)
N_MFCC = 128
N_MELS = 128
HOP_LENGTH = 512
FIXED_TIME_STEPS = 500
SHIFTING_FACTOR = 0.1
AMPLIFICATION_FACTOR = 1.2

# Load model
MODEL_PATH = Path("both-2k-modal-amp.h5")
model = tf.keras.models.load_model(MODEL_PATH)

# Bandpass Filter Function
def apply_bandpass_filter(audio, sr, low_freq=100, high_freq=20000):
    nyquist = sr / 2
    low = low_freq / nyquist
    high = high_freq / nyquist
    b, a = butter(N=4, Wn=[low, high], btype='band')
    return lfilter(b, a, audio)

# Audio Processing Functions
def normalize_audio(audio):
    return librosa.util.normalize(audio)

def amplify_audio(audio):
    max_amplitude = np.max(np.abs(audio))
    if max_amplitude > 0:
        amplification_factor = AMPLIFICATION_FACTOR / max_amplitude
        audio = audio * amplification_factor
    return np.clip(audio, -1.0, 1.0)

def pad_or_trim_audio(audio, target_length=TARGET_SAMPLES):
    if len(audio) < target_length:
        return np.pad(audio, (0, target_length - len(audio)), mode='constant')
    else:
        return audio[:target_length]

def trim_silence(audio):
    audio, _ = librosa.effects.trim(audio)
    return audio

def segment_audio(audio, segment_duration=TARGET_DURATION, shift_duration=SHIFTING_FACTOR):
    segments = []
    segment_samples = int(segment_duration * SAMPLE_RATE)
    step_size = int(shift_duration * SAMPLE_RATE)
    total_samples = len(audio)

    for start in range(0, total_samples - segment_samples + 1, step_size):
        end = start + segment_samples
        segments.append((start / SAMPLE_RATE, end / SAMPLE_RATE, audio[start:end]))

    if len(segments) == 0 or len(audio) > segment_samples and total_samples % step_size != 0:
        start = total_samples - segment_samples
        segment = np.pad(audio[start:], (0, segment_samples - len(audio[start:])), mode='constant')
        segments.append((start / SAMPLE_RATE, total_samples / SAMPLE_RATE, segment))

    return segments

def extract_mel_features(audio, sr=SAMPLE_RATE, n_mels=N_MELS, hop_length=HOP_LENGTH, target_time_steps=FIXED_TIME_STEPS):
    mel_features = librosa.feature.melspectrogram(y=audio, sr=sr, n_mels=n_mels, hop_length=hop_length)
    mel_padded = np.zeros((n_mels, target_time_steps))
    mel_padded[:, :mel_features.shape[1]] = mel_features[:, :target_time_steps]
    return mel_padded[..., np.newaxis]

def extract_mfcc_features(audio, sr=SAMPLE_RATE, n_mfcc=N_MFCC, hop_length=HOP_LENGTH, target_time_steps=FIXED_TIME_STEPS):
    mfcc_features = librosa.feature.mfcc(y=audio, sr=sr, n_mfcc=n_mfcc, hop_length=hop_length)
    mfcc_padded = np.zeros((n_mfcc, target_time_steps))
    mfcc_padded[:, :mfcc_features.shape[1]] = mfcc_features[:, :target_time_steps]
    return mfcc_padded[..., np.newaxis]

def predict_segments(filepath):
    try:
        audio, _ = librosa.load(filepath, sr=SAMPLE_RATE)
        audio = trim_silence(audio)

        if len(audio) == 0:
            print(f"No meaningful sound in {filepath}. Defaulting to 'non'.")
            return [{"start_time": 0, "end_time": TARGET_DURATION, "predicted_label": "non"}]

        # Apply bandpass filter
        audio = apply_bandpass_filter(audio, SAMPLE_RATE)

        segments = segment_audio(audio)
        predictions = []

        for start_time, end_time, segment in segments:
            segment = normalize_audio(segment)
            segment = amplify_audio(segment)
            segment = pad_or_trim_audio(segment)

            mel_features = extract_mel_features(segment)
            mfcc_features = extract_mfcc_features(segment)

            mel_features = np.expand_dims(mel_features, axis=0)
            mfcc_features = np.expand_dims(mfcc_features, axis=0)
            combined_features = [mfcc_features, mel_features]

            prediction = model.predict(combined_features)
            predicted_class = np.argmax(prediction, axis=1)[0]
            predicted_label = CLASS_LABELS[predicted_class] if predicted_class < len(CLASS_LABELS) else "Unknown"

            predictions.append({
                "start_time": start_time,
                "end_time": end_time,
                "predicted_label": predicted_label
            })

            print(f"Prediction: Start={start_time}s, End={end_time}s, Label={predicted_label}")

        return predictions

    except Exception as e:
        print(f"Error processing {filepath}: {e}")
        return [{"start_time": 0, "end_time": TARGET_DURATION, "predicted_label": "non"}]

def monitor_server():
    content = set(DATA_SOURCE.iterdir())
    print("Server running...")

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server_socket:
        server_socket.bind(('127.0.0.1', 65432))
        server_socket.listen(1)
        while True:
            client_socket, addr = server_socket.accept()
            with client_socket:
                data = client_socket.recv(1024)
                if not data:
                    break

                new_files = list(set(DATA_SOURCE.iterdir()) - content)
                if new_files:
                    filename = new_files[0]
                    print(f"Processing new file: {filename}")
                    final_predictions = predict_segments(filename)
                    response = f"Predicted labels for segments: {final_predictions}"
                    print(f"Response sent to client: {response}")
                    client_socket.sendall(response.encode('utf-8'))
                    content = set(DATA_SOURCE.iterdir())
                else:
                    client_socket.sendall(b'No detected changes')

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run inference in server or CLI mode")
    parser.add_argument("--mode", choices=["server", "cli"], required=True, help="Mode to run the script: server or cli")
    parser.add_argument("--file", type=str, help="Path to audio file for CLI mode")
    
    args = parser.parse_args()

    if args.mode == "server":
        monitor_server()
    elif args.mode == "cli" and args.file:
        final_predictions = predict_segments(args.file)
        for prediction in final_predictions:
            print(f"Start Time: {prediction['start_time']}s, End Time: {prediction['end_time']}s, Predicted Label: {prediction['predicted_label']}")
