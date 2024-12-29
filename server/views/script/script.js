class VoiceRecorder {
    constructor() {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            console.log("getUserMedia supported");
        } else {
            console.log("getUserMedia is not supported on your browser!");
        }

        this.mediaRecorder = null;
        this.stream = null;
        this.chunks = [];
        this.isRecording = false;
        
        this.recorderRef = document.querySelector("#recorder");
        this.playerRef = document.querySelector("#player");
        this.startRef = document.querySelector("#start");
        this.stopRef = document.querySelector("#stop");
        this.uploadButton = document.querySelector(".upload-button");
        
        this.startRef.onclick = this.startRecording.bind(this);
        this.stopRef.onclick = this.stopRecording.bind(this);
        this.uploadButton.onclick = this.uploadAudio.bind(this);
        this.uploadSuccessRef = document.querySelector('.container-2 .title');

        this.constraints = {
            audio: true,
            video: false
        };
    }

    handleSuccess(stream) {
        this.stream = stream;
        this.stream.oninactive = () => {
            console.log("Stream ended!");
        };
        this.recorderRef.srcObject = this.stream;
        this.mediaRecorder = new MediaRecorder(this.stream);
        console.log(this.mediaRecorder);
        this.mediaRecorder.ondataavailable = this.onMediaRecorderDataAvailable.bind(this);
        this.mediaRecorder.onstop = this.onMediaRecorderStop.bind(this);
        this.recorderRef.play();
        this.mediaRecorder.start();
    }

    handleError(error) {
        console.log("navigator.getUserMedia error: ", error);
    }
    
    onMediaRecorderDataAvailable(e) {
        this.chunks.push(e.data);
    }
    
    onMediaRecorderStop() { 
        const blob = new Blob(this.chunks, { 'type': 'audio/wav; codecs=opus' });
        const audioURL = window.URL.createObjectURL(blob);
        this.playerRef.src = audioURL;
        this.chunks = [];
        this.stream.getAudioTracks().forEach(track => track.stop());
        this.stream = null;
        this.playerRef.classList.remove('hidden');
        //document.querySelector('.title').classList.remove('hidden');
        this.stopRef.classList.add('hidden');
        this.startRef.classList.remove('hidden');

        // Upload the recorded audio to the server
        this.uploadToServer(blob);
    }

    startRecording() {
        if (this.isRecording) return;
        this.isRecording = true;
        this.startRef.classList.add('hidden');
        this.stopRef.classList.remove('hidden');
        this.playerRef.src = '';
        //this.playerRef.classList.add('hidden');
        //document.querySelector('.title').classList.add('hidden');

        navigator.mediaDevices
            .getUserMedia(this.constraints)
            .then(this.handleSuccess.bind(this))
            .catch(this.handleError.bind(this));
    }
    
    stopRecording() {
        if (!this.isRecording) return;
        this.isRecording = false;
        this.recorderRef.pause();
        this.mediaRecorder.stop();
    }
    
    uploadAudio() {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".wav"; // Accept only WAV files
        fileInput.onchange = (event) => {
            const file = event.target.files[0];
            if (file) {
                const audioURL = URL.createObjectURL(file);
                this.playerRef.src = audioURL; // Set the audio player source
                this.playerRef.classList.remove('hidden');
                this.uploadToServer(file); 
                //this.uploadSuccessRef.classList.remove('hidden');
            }
        };
        fileInput.click(); // Open the file explorer
    }

    uploadToServer(blob) {
        const formData = new FormData();
        formData.append("audio", blob, "recording.wav");
    
        fetch('http://localhost:5000/upload', {
            method: 'POST',
            body: formData,
        })
        .then(response => response.text())
        .then(data => {
            console.log('Success:', data);
            this.uploadSuccessRef.textContent = "File uploaded successfully!";
        })
        .catch(error => {
            console.error('Error:', error);
            this.uploadSuccessRef.textContent = "File upload failed!";
        });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    window.voiceRecorder = new VoiceRecorder();
    const txtDiv = document.getElementById("txtDiv");
    const paginationDiv = document.getElementById("paginationDiv");

    const itemsPerPage = 5; // Max items per page
    let currentPage = 1;
    let totalItems = [];
  
    const ws = new WebSocket('ws://localhost:8080');

    ws.onmessage = function(event) {
        const message = event.data;
        const clean_outer = message.slice(1, -1);
        const split_message = clean_outer.split(', ');
        console.log(split_message);

        // Clear previous content
        txtDiv.innerHTML = ''; // Clear the txtDiv content
        paginationDiv.innerHTML = ''; // Clear pagination controls
        totalItems = split_message.map((item, index) => {
            const final_clean = item.slice(1, -1);
            if(final_clean == 'Frog'){
                return { text: `Segment ${index + 1}: ${final_clean} 🐸`, index: index };
            }else if(final_clean == 'Bat'){
                return { text: `Segment ${index + 1}: ${final_clean} 🦇`, index: index };
            }else{
                return { text: `Segment ${index + 1}: ${final_clean}`, index: index };
            }
        });

        renderPage();
    };

    function renderPage() {
        txtDiv.innerHTML = '';

        const startIndex = (currentPage - 1) * itemsPerPage;
        const paginatedItems = totalItems.slice(startIndex, startIndex + itemsPerPage);

        paginatedItems.forEach((item) => {
            const card = document.createElement('div');
            card.style.cssText = `
                border: 1px solid #ccc;
                border-radius: 8px;
                padding: 10px;
                margin-bottom: 5px;
                background-color: #ffffff;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            `;
            card.textContent = item.text;
            txtDiv.appendChild(card);
        });

        renderPaginationControls();
    }

    function renderPaginationControls() {
        paginationDiv.innerHTML = '';
    
        const totalPages = Math.ceil(totalItems.length / itemsPerPage);
       
        const prevButton = document.createElement('button');
        prevButton.textContent = "Previous";
        prevButton.style.cssText = `
            padding: 5px 10px; /* Smaller padding */
            background-color: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 5px;
            font-size: 12px; /* Smaller font size */
        `;
        prevButton.disabled = currentPage === 1;
        prevButton.onclick = () => {
            currentPage -= 1;
            renderPage();
        };
        paginationDiv.appendChild(prevButton);
    
        // Page Numbers
        for (let i = 1; i <= totalPages; i++) {
            const pageButton = document.createElement('button');
            pageButton.textContent = i;
            pageButton.style.cssText = `
                padding: 5px 10px; /* Smaller padding */
                background-color: ${i === currentPage ? '#28a745' : '#f8f9fa'};
                color: ${i === currentPage ? 'white' : 'black'};
                border: 1px solid #ccc;
                border-radius: 4px;
                cursor: pointer;
                margin:2px;
                font-size: 12px; /* Smaller font size */
            `;
            pageButton.onclick = () => {
                currentPage = i;
                renderPage();
            };
            paginationDiv.appendChild(pageButton);
        }
    
        // Next Button
        const nextButton = document.createElement('button');
        nextButton.textContent = "Next";
        nextButton.style.cssText = `
            padding: 5px 10px; /* Smaller padding */
            background-color: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            margin-left: 5px;
            font-size: 12px; /* Smaller font size */
        `;
        nextButton.disabled = currentPage === totalPages;
        nextButton.onclick = () => {
            currentPage += 1;
            renderPage();
        };
        paginationDiv.appendChild(nextButton);
    }
});

