from flask import Flask, request, jsonify
from flask_cors import CORS
import face_recognition
import numpy as np
import pickle
import os

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)
DB_PATH = "models/face_db.pkl"

# Load or create database
if not os.path.exists(DB_PATH):
    face_db = {}
else:
    with open(DB_PATH, "rb") as f:
        face_db = pickle.load(f)

def save_db():
    with open(DB_PATH, "wb") as f:
        pickle.dump(face_db, f)

@app.route('/api/enroll-face', methods=['POST'])
def enroll_face():
    file = request.files.get('image')
    face_id = request.form.get('faceId')      # <-- unique faceId (MongoDB _id)
    name = request.form.get('name')           # optional, for logging only
    if not file or not face_id:
        return jsonify({'status': 'fail', 'message': 'faceId and image required'}), 400
    img = face_recognition.load_image_file(file)
    encodings = face_recognition.face_encodings(img)
    if encodings:
        face_db[face_id] = encodings[0]
        save_db()
        return jsonify({'status': 'success', 'faceId': face_id, 'message': f'Face enrolled.', 'name': name})
    else:
        return jsonify({'status': 'fail', 'message': 'No face found', 'faceId': face_id}), 422

@app.route('/api/verify-face', methods=['POST'])
def verify_face():
    file = request.files.get('image')
    if not file:
        return jsonify({'status': 'fail', 'message': 'Image required'}), 400
    img = face_recognition.load_image_file(file)
    encodings = face_recognition.face_encodings(img)
    if not encodings:
        return jsonify({'status': 'fail', 'message': 'No face found'}), 422
    encoding = encodings[0]
    for faceId, db_encoding in face_db.items():
        match = face_recognition.compare_faces([db_encoding], encoding)[0]
        if match:
            return jsonify({'status': 'success', 'message': f'Match: {faceId}', 'faceId': faceId})
    return jsonify({'status': 'fail', 'message': 'No match found'}), 404

if __name__ == '__main__':
    os.makedirs('models', exist_ok=True)
    app.run(debug=True, port=5001, host='0.0.0.0')
