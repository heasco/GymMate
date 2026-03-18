from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import os
import uuid
from pymongo import MongoClient
from encryption_utils import encrypt_data, decrypt_data
from deepface import DeepFace
from dotenv import load_dotenv
import logging

# Load environment variables from .env file
load_dotenv()

# --- App & Logging Setup ---
app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Configure CORS to allow requests from your frontend
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

# --- MongoDB Setup ---
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
client = MongoClient(MONGO_URI)
db = client.face_recognition_db
faces_collection = db.faces
logging.info("Successfully connected to MongoDB.")

# Ensure temp directory exists for DeepFace processing
os.makedirs('temp_faces', exist_ok=True)

@app.route('/api/enroll-face', methods=['POST'])
def enroll_face():
    # 1. Validate incoming request
    if 'image1' not in request.files or 'image2' not in request.files or 'image3' not in request.files:
        logging.warning("Enrollment failed: Missing one or more images.")
        return jsonify({'status': 'fail', 'message': 'Three images are required'}), 400

    face_id = request.form.get('faceId')
    name = request.form.get('name', '')

    if not face_id:
        logging.warning("Enrollment failed: faceId is required.")
        return jsonify({'status': 'fail', 'message': 'faceId is required'}), 400

    if faces_collection.find_one({'faceId': face_id}):
        logging.warning(f"Enrollment failed: Face with faceId {face_id} already exists.")
        return jsonify({'status': 'fail', 'message': f'Face with faceId {face_id} already exists'}), 409

    images = [request.files.get('image1'), request.files.get('image2'), request.files.get('image3')]
    encodings = []
    temp_paths = []

    try:
        # 2. Save images temporarily and extract encodings
        for i, img in enumerate(images):
            temp_path = os.path.join('temp_faces', f"{uuid.uuid4()}.jpg")
            img.save(temp_path)
            temp_paths.append(temp_path)

            logging.info(f"Processing image {i+1} for faceId: {face_id}")
            embedding_objs = DeepFace.represent(img_path=temp_path, model_name="Facenet", enforce_detection=True)
            
            if embedding_objs and len(embedding_objs) > 0:
                encodings.append(embedding_objs[0]["embedding"])
            else:
                logging.warning(f"No face detected in image {i+1} for faceId: {face_id}")
                return jsonify({'status': 'fail', 'message': f'No face detected in image {i+1}'}), 400

        # 3. Average encodings and encrypt
        avg_encoding = np.mean(encodings, axis=0)
        avg_encoding_bytes = np.array(avg_encoding, dtype=np.float64).tobytes()
        encrypted_encoding = encrypt_data(avg_encoding_bytes)

        # 4. Save to database
        face_data = {'faceId': face_id, 'name': name, 'encoding': encrypted_encoding}
        faces_collection.insert_one(face_data)
        logging.info(f"Successfully enrolled faceId: {face_id}")

        return jsonify({'status': 'success', 'message': 'Face enrolled successfully', 'faceId': face_id})

    except Exception as e:
        logging.error(f"Enrollment error for faceId {face_id}: {str(e)}", exc_info=True)
        # Check if the error is due to face detection
        if "Face could not be detected" in str(e) or "DetectedFace is empty" in str(e):
             return jsonify({'status': 'fail', 'message': 'Could not detect a face in one or more images.'}), 400
        return jsonify({'status': 'fail', 'message': f'An unexpected error occurred: {str(e)}'}), 500
    finally:
        # 5. Clean up temporary files
        for path in temp_paths:
            if os.path.exists(path):
                os.remove(path)


@app.route('/api/verify-face', methods=['POST'])
def verify_face():
    if 'image' not in request.files:
        logging.warning("Verification failed: Image is required.")
        return jsonify({'status': 'fail', 'message': 'Image is required'}), 400

    img = request.files['image']
    temp_path = os.path.join('temp_faces', f"temp_verify_{uuid.uuid4()}.jpg")
    
    try:
        img.save(temp_path)
        logging.info("Verification image saved. Attempting to extract face embedding.")

        # 1. Extract embedding from the uploaded image
        try:
            embedding_objs = DeepFace.represent(img_path=temp_path, model_name="Facenet", enforce_detection=True)
            if not embedding_objs or len(embedding_objs) == 0:
                logging.warning("No face detected in the verification image.")
                return jsonify({'status': 'fail', 'message': 'No face detected in the verification image'}), 400
            
            unknown_encoding = np.array(embedding_objs[0]["embedding"], dtype=np.float64)
            logging.info("Successfully extracted embedding from verification image.")
        except Exception as represent_error:
            logging.error(f"Face representation failed: {represent_error}", exc_info=True)
            return jsonify({'status': 'fail', 'message': 'Could not process the image. A face may not be clearly visible.'}), 400

        # 2. Fetch all enrolled faces from the database
        all_faces = list(faces_collection.find({}))
        if not all_faces:
            logging.warning("Verification failed: No faces are enrolled in the database.")
            return jsonify({'status': 'fail', 'message': 'No faces enrolled in the database'}), 404

        best_match_id = None
        highest_similarity_score = -1.0  # Cosine similarity ranges from -1 to 1

        logging.info(f"Comparing uploaded face against {len(all_faces)} enrolled faces.")

        # 3. Iterate through enrolled faces and find the best match
        for enrolled_face in all_faces:
            face_id = enrolled_face.get('faceId', 'Unknown')
            try:
                decrypted_bytes = decrypt_data(enrolled_face['encoding'])
                enrolled_encoding = np.frombuffer(decrypted_bytes, dtype=np.float64)

                # --- Cosine Similarity Calculation ---
                dot_product = np.dot(enrolled_encoding, unknown_encoding)
                norm_enrolled = np.linalg.norm(enrolled_encoding)
                norm_unknown = np.linalg.norm(unknown_encoding)
                
                # Avoid division by zero
                if norm_enrolled == 0 or norm_unknown == 0:
                    logging.warning(f"Skipping face {face_id} due to zero vector norm, indicating corrupted data.")
                    continue
                    
                similarity = dot_product / (norm_enrolled * norm_unknown)
                # ------------------------------------

                # Update the best match if the current face has a higher similarity score
                if similarity > highest_similarity_score:
                    highest_similarity_score = similarity
                    best_match_id = face_id
                    
            except Exception as comparison_err:
                logging.error(f"Decryption or comparison failed for faceId {face_id}: {comparison_err}", exc_info=True)
                continue

        # 4. Determine if the best match meets the verification threshold
        # This threshold is critical and may need tuning based on real-world performance.
        # A score > 0.65 is a good starting point for the Facenet model.
        VERIFICATION_THRESHOLD = 0.65
        
        if best_match_id and highest_similarity_score >= VERIFICATION_THRESHOLD:
            logging.info(f"Verification successful for faceId: {best_match_id} with score: {highest_similarity_score:.4f}")
            return jsonify({
                'status': 'success', 
                'message': 'Face verified successfully', 
                'faceId': best_match_id, 
                'similarity': f"{highest_similarity_score:.4f}"
            })
        else:
            logging.warning(f"Verification failed. Best match score of {highest_similarity_score:.4f} for faceId {best_match_id} is below the threshold of {VERIFICATION_THRESHOLD}.")
            return jsonify({
                'status': 'fail', 
                'message': 'No matching face found. Please try again.',
                'similarity': f"{highest_similarity_score:.4f}" if highest_similarity_score != -1 else "N/A"
            }), 404

    except Exception as e:
        logging.error(f"An unexpected error occurred during the verification process: {str(e)}", exc_info=True)
        return jsonify({'status': 'fail', 'message': 'An internal server error occurred.'}), 500
    finally:
        # Clean up the temporary image file
        if os.path.exists(temp_path):
            os.remove(temp_path)


if __name__ == '__main__':
    # Run the Flask app
    logging.info("Starting Flask app...")
    app.run(host='0.0.0.0', port=5000, debug=True)