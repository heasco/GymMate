from flask import Flask, request, jsonify
from flask_cors import CORS
import face_recognition
import numpy as np
import os
from pymongo import MongoClient
from encryption_utils import encrypt_data, decrypt_data

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

# --- MongoDB Setup ---
# It's recommended to use environment variables for connection strings in production
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
client = MongoClient(MONGO_URI)
db = client.face_recognition_db
faces_collection = db.faces

@app.route('/api/enroll-face', methods=['POST'])
def enroll_face():
    if 'image1' not in request.files or 'image2' not in request.files or 'image3' not in request.files:
        return jsonify({'status': 'fail', 'message': 'Three images are required'}), 400

    face_id = request.form.get('faceId')
    if not face_id:
        return jsonify({'status': 'fail', 'message': 'faceId is required'}), 400

    name = request.form.get('name', '')  # Optional name

    # Check if faceId already exists
    if faces_collection.find_one({'faceId': face_id}):
        return jsonify({'status': 'fail', 'message': f'Face with faceId {face_id} already exists'}), 409

    images = [
        request.files.get('image1'),
        request.files.get('image2'),
        request.files.get('image3')
    ]

    face_encodings_list = []
    for img_file in images:
        try:
            img = face_recognition.load_image_file(img_file)
            encodings = face_recognition.face_encodings(img)
            if encodings:
                face_encodings_list.append(encodings[0])
            else:
                return jsonify({'status': 'fail', 'message': f'No face found in one of the images ({img_file.filename})'}), 422
        except Exception as e:
            return jsonify({'status': 'fail', 'message': f'Error processing image {img_file.filename}: {str(e)}'}), 500

    if len(face_encodings_list) != 3:
        return jsonify({'status': 'fail', 'message': 'Could not process all three images'}), 500

    # Calculate the average of the face encodings
    average_encoding = np.mean(face_encodings_list, axis=0)

    # Encrypt the face encoding
    encrypted_encoding = encrypt_data(average_encoding.tobytes())

    # Store in MongoDB
    faces_collection.insert_one({
        'faceId': face_id,
        'name': name,
        'encoding': encrypted_encoding
    })

    return jsonify({'status': 'success', 'faceId': face_id, 'message': f'Face for {name} enrolled successfully.'})


@app.route('/api/verify-face', methods=['POST'])
def verify_face():
    if 'image' not in request.files:
        return jsonify({'status': 'fail', 'message': 'Image is required'}), 400

    img_file = request.files.get('image')

    try:
        img = face_recognition.load_image_file(img_file)
        unknown_encodings = face_recognition.face_encodings(img)

        if not unknown_encodings:
            return jsonify({'status': 'fail', 'message': 'No face found in the image'}), 422

        unknown_encoding = unknown_encodings[0]

        # Fetch all faces from the database
        all_faces = list(faces_collection.find({}))

        if not all_faces:
            return jsonify({'status': 'fail', 'message': 'No faces enrolled in the database'}), 404

        known_encodings = []
        face_ids = []
        for face in all_faces:
            decrypted_encoding_bytes = decrypt_data(face['encoding'])
            # The encoding was stored as bytes, so we need to convert it back to a numpy array
            decrypted_encoding = np.frombuffer(decrypted_encoding_bytes, dtype=np.float64)
            known_encodings.append(decrypted_encoding)
            face_ids.append(face['faceId'])

        # Compare the unknown face with all known faces
        matches = face_recognition.compare_faces(known_encodings, unknown_encoding)

        if True in matches:
            first_match_index = matches.index(True)
            matched_face_id = face_ids[first_match_index]
            return jsonify({'status': 'success', 'message': 'Face verified', 'faceId': matched_face_id})
        else:
            return jsonify({'status': 'fail', 'message': 'No matching face found'}), 404

    except Exception as e:
        return jsonify({'status': 'fail', 'message': f'An error occurred: {str(e)}'}), 500


if __name__ == '__main__':
    # Ensure the 'models' directory exists for any legacy or other model files if needed
    os.makedirs('models', exist_ok=True)
    # Note: For production, use a proper WSGI server like Gunicorn or uWSGI
    app.run(debug=True, port=5001, host='0.0.0.0')
