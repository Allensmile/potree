

class ProfilePointCloudEntry{

	constructor(){

		this.points = [];

		let geometry = new THREE.BufferGeometry();
		let material = new Potree.PointCloudMaterial();
		material.uniforms.minSize.value = 2;
		material.uniforms.maxSize.value = 2;
		material.pointColorType = Potree.PointColorType.RGB;
		material.opacity = 1.0;
		this.sceneNode = new THREE.Points(geometry, material);
	}


	addPoints(data){
		this.points.push(data);

		let projectedBox = new THREE.Box3();
		
		{ // REBUILD MODEL

			if(this.sceneNode){
				this.sceneNode.geometry.dispose();
			}

			let numPoints = this.points.reduce((a, i) => a + i.numPoints, 0);

			let geometry = new THREE.BufferGeometry();
			let buffers = {
				position: new Float32Array(3 * numPoints),
				color: new Uint8Array(4 * numPoints),
				intensity: new Uint16Array(numPoints),
				classification: new Uint8Array(numPoints),
				returnNumber: new Uint8Array(numPoints),
				numberOfReturns: new Uint8Array(numPoints),
				pointSourceID: new Uint16Array(numPoints)
			};

			let pointsProcessed = 0;
			for(let part of this.points){
				
				for(let i = 0; i < part.numPoints; i++){
					let x = part.data.mileage[i];
					let y = part.data.position[3 * i + 2];
					let z = 0;

					projectedBox.expandByPoint(new THREE.Vector3(x, y, 0));

					buffers.position[3 * pointsProcessed + 0] = x;
					buffers.position[3 * pointsProcessed + 1] = y;
					buffers.position[3 * pointsProcessed + 2] = z;

					if( part.data.color){
						buffers.color[4 * pointsProcessed + 0] = part.data.color[4 * i + 0];
						buffers.color[4 * pointsProcessed + 1] = part.data.color[4 * i + 1];
						buffers.color[4 * pointsProcessed + 2] = part.data.color[4 * i + 2];
						buffers.color[4 * pointsProcessed + 3] = 255;
					}

					pointsProcessed++;
				}

			}

			data.projectedBox = projectedBox;

			this.projectedBox = this.points.reduce( (a, i) => a.union(i.projectedBox), new THREE.Box3());

			geometry.addAttribute('position', new THREE.BufferAttribute(buffers.position, 3));
			geometry.addAttribute('color', new THREE.BufferAttribute(buffers.color, 4, true));
			geometry.addAttribute('intensity', new THREE.BufferAttribute(buffers.intensity, 1, false));
			geometry.addAttribute('classification', new THREE.BufferAttribute(buffers.classification, 1, false));
			geometry.addAttribute('returnNumber', new THREE.BufferAttribute(buffers.returnNumber, 1, false));
			geometry.addAttribute('numberOfReturns', new THREE.BufferAttribute(buffers.numberOfReturns, 1, false));
			geometry.addAttribute('pointSourceID', new THREE.BufferAttribute(buffers.pointSourceID, 1, false));

			this.sceneNode.geometry = geometry;

		}


	}

};

Potree.ProfileWindow = class ProfileWindow extends THREE.EventDispatcher {
	constructor () {
		super();

		this.elRoot = $('#profile_window');
		this.renderArea = this.elRoot.find('#profileCanvasContainer');
		this.svg = d3.select('svg#profileSVG');
		this.mouseIsDown = false;

		this.projectedBox = new THREE.Box3();
		this.pointclouds = new Map();
		this.numPoints = 0;

		this.mouse = new THREE.Vector2(0, 0);
		this.scale = new THREE.Vector3(1, 1, 1);

		let csvIcon = `${Potree.resourcePath}/icons/file_csv_2d.svg`;
		$('#potree_download_csv_icon').attr('src', csvIcon);

		let lasIcon = `${Potree.resourcePath}/icons/file_las_3d.svg`;
		$('#potree_download_las_icon').attr('src', lasIcon);

		this.initTHREE();
		this.initSVG();
		this.initListeners();
	}

	initListeners () {
		$(window).resize(() => {
			this.render();
		});

		this.renderArea.mousedown(e => {
			this.mouseIsDown = true;
		});

		this.renderArea.mouseup(e => {
			this.mouseIsDown = false;
		});

		this.renderArea.mousemove(e => {
			if (this.pointclouds.size === 0) {
				return;
			}

			let rect = this.renderArea[0].getBoundingClientRect();
			let x = e.clientX - rect.left;
			let y = e.clientY - rect.top;

			let newMouse = new THREE.Vector2(x, y);

			if (this.mouseIsDown) {
				// DRAG
				this.autoFit = false;

				let cPos = [this.scaleX.invert(this.mouse.x), this.scaleY.invert(this.mouse.y)];
				let ncPos = [this.scaleX.invert(newMouse.x), this.scaleY.invert(newMouse.y)];

				this.camera.position.x -= ncPos[0] - cPos[0];
				this.camera.position.y -= ncPos[1] - cPos[1];

				this.render();
			} else if (this.pointclouds.size > 0) {
				// FIND HOVERED POINT
				let radius = Math.abs(this.scaleX.invert(0) - this.scaleX.invert(5));
				let mileage = this.scaleX.invert(newMouse.x);
				let elevation = this.scaleY.invert(newMouse.y);
				let point = this.selectPoint(mileage, elevation, radius);

				if (point) {
					this.elRoot.find('#profileSelectionProperties').fadeIn(200);
					this.pickSphere.visible = true;
					this.pickSphere.scale.set(0.5 * radius, 0.5 * radius, 0.5 * radius);
					this.pickSphere.position.set(point.mileage, point.position[2], 0);

					let info = this.elRoot.find('#profileSelectionProperties');
					let html = '<table>';
					for (let attribute of Object.keys(point)) {
						let value = point[attribute];
						if (attribute === 'position') {
							let values = [...value].map(v => Potree.utils.addCommas(v.toFixed(3)));
							html += `
								<tr>
									<td>x</td>
									<td>${values[0]}</td>
								</tr>
								<tr>
									<td>y</td>
									<td>${values[1]}</td>
								</tr>
								<tr>
									<td>z</td>
									<td>${values[2]}</td>
								</tr>`;
						} else if (attribute === 'color') {
							html += `
								<tr>
									<td>${attribute}</td>
									<td>${value.join(', ')}</td>
								</tr>`;
						} else if (attribute === 'normal') {
							continue;
						} else if (attribute === 'mileage') {
							html += `
								<tr>
									<td>${attribute}</td>
									<td>${value.toFixed(3)}</td>
								</tr>`;
						} else {
							html += `
								<tr>
									<td>${attribute}</td>
									<td>${value}</td>
								</tr>`;
						}
					}
					html += '</table>';
					info.html(html);

					this.selectedPoint = point;
				} else {
					// this.pickSphere.visible = false;
					// this.selectedPoint = null;
				}
				this.render();
			}

			this.mouse.copy(newMouse);
		});

		let onWheel = e => {
			this.autoFit = false;
			let delta = 0;
			if (e.wheelDelta !== undefined) { // WebKit / Opera / Explorer 9
				delta = e.wheelDelta;
			} else if (e.detail !== undefined) { // Firefox
				delta = -e.detail;
			}

			let ndelta = Math.sign(delta);

			// let sPos = new THREE.Vector3(this.mouse.x, this.mouse.y, 0);
			// let cPos = this.toCamSpace(sPos);

			let cPos = [this.scaleX.invert(this.mouse.x), this.scaleY.invert(this.mouse.y)];

			if (ndelta > 0) {
				// + 10%
				this.scale.multiplyScalar(1.1);
			} else {
				// - 10%
				this.scale.multiplyScalar(100 / 110);
			}

			// this.scale.max(new THREE.Vector3(0.5, 0.5, 0.5));
			// this.scale.min(new THREE.Vector3(100, 100, 100));

			this.updateScales();
			let ncPos = [this.scaleX.invert(this.mouse.x), this.scaleY.invert(this.mouse.y)];

			this.camera.position.x -= ncPos[0] - cPos[0];
			this.camera.position.y -= ncPos[1] - cPos[1];

			this.render();
		};
		$(this.renderArea)[0].addEventListener('mousewheel', onWheel, false);
		$(this.renderArea)[0].addEventListener('DOMMouseScroll', onWheel, false); // Firefox

		$('#closeProfileContainer').click(() => {
			this.hide();
		});

		$('#potree_download_csv_icon').click(() => {
			let points = new Potree.Points();
			this.pointclouds.forEach((value, key) => {
				points.add(value.points);
			});

			let string = Potree.CSVExporter.toString(points);

			let uri = 'data:application/octet-stream;base64,' + btoa(string);
			$('#potree_download_profile_ortho_link').attr('href', uri);
		});

		$('#potree_download_las_icon').click(() => {
			let points = new Potree.Points();
			this.pointclouds.forEach((value, key) => {
				points.add(value.points);
			});

			let buffer = Potree.LASExporter.toLAS(points);
			let u8view = new Uint8Array(buffer);

			let binString = '';
			for (let i = 0; i < u8view.length; i++) {
				binString += String.fromCharCode(u8view[i]);
			}

			let uri = 'data:application/octet-stream;base64,' + btoa(binString);
			$('#potree_download_profile_link').attr('href', uri);
		});
	}

	selectPoint (mileage, elevation, radius) {
		let closest = {
			distance: Infinity,
			pointcloud: null,
			points: null,
			index: null
		};

		for (let [pointcloud, entry] of this.pointclouds) {
			let points = entry.points;

			for (let i = 0; i < points.numPoints; i++) {
				// let pos = new THREE.Vector3(...points.data.position.subarray(3*i, 3*i+3));
				let m = points.data.mileage[i] - mileage;
				let e = points.data.position[3 * i + 2] - elevation;

				let r = Math.sqrt(m * m + e * e);

				if (r < radius && r < closest.distance) {
					closest = {
						distance: r,
						pointcloud: pointcloud,
						points: points,
						index: i
					};
				}
			}
		}

		if (closest.distance < Infinity) {
			let points = closest.points;

			let point = {};

			let attributes = Object.keys(points.data);
			for (let attribute of attributes) {
				let attributeData = points.data[attribute];
				let itemSize = attributeData.length / points.numPoints;
				let value = attributeData.subarray(itemSize * closest.index, itemSize * closest.index + itemSize);

				if (value.length === 1) {
					point[attribute] = value[0];
				} else {
					point[attribute] = value;
				}
			}

			return point;
		} else {
			return null;
		}
	}

	initTHREE () {
		this.renderer = new THREE.WebGLRenderer({alpha: true, premultipliedAlpha: false});
		this.renderer.setClearColor(0x000000, 0);
		this.renderer.setSize(10, 10);
		this.renderer.autoClear = true;
		this.renderArea.append($(this.renderer.domElement));
		this.renderer.domElement.tabIndex = '2222';
		this.renderer.context.getExtension('EXT_frag_depth');
		$(this.renderer.domElement).css('width', '100%');
		$(this.renderer.domElement).css('height', '100%');

		this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -1000, 1000);

		this.scene = new THREE.Scene();

		let sg = new THREE.SphereGeometry(1, 16, 16);
		let sm = new THREE.MeshNormalMaterial();
		this.pickSphere = new THREE.Mesh(sg, sm);
		//this.pickSphere.visible = false;
		this.scene.add(this.pickSphere);
	}

	initSVG () {
		let width = this.renderArea[0].clientWidth;
		let height = this.renderArea[0].clientHeight;
		let marginLeft = this.renderArea[0].offsetLeft;

		this.svg.selectAll('*').remove();

		this.scaleX = d3.scale.linear()
			.domain([this.camera.left + this.camera.position.x, this.camera.right + this.camera.position.x])
			.range([0, width]);
		this.scaleY = d3.scale.linear()
			.domain([this.camera.bottom + this.camera.position.y, this.camera.top + this.camera.position.y])
			.range([height, 0]);

		this.xAxis = d3.svg.axis()
			.scale(this.scaleX)
			.orient('bottom')
			.innerTickSize(-height)
			.outerTickSize(1)
			.tickPadding(10)
			.ticks(width / 50);

		this.yAxis = d3.svg.axis()
			.scale(this.scaleY)
			.orient('left')
			.innerTickSize(-width)
			.outerTickSize(1)
			.tickPadding(10)
			.ticks(height / 20);

		this.svg.append('g')
			.attr('class', 'x axis')
			.attr('transform', `translate(${marginLeft}, ${height})`)
			.call(this.xAxis);

		this.svg.append('g')
			.attr('class', 'y axis')
			.attr('transform', `translate(${marginLeft}, 0)`)
			.call(this.yAxis);
	}

	setProfile (profile) {
		this.render();
	}

	addPoints (pointcloud, points) {

		let entry = this.pointclouds.get(pointcloud);
		if(!entry){
			entry = new ProfilePointCloudEntry();
			this.pointclouds.set(pointcloud, entry);

			let materialChanged = () => this.render();
			pointcloud.material.addEventListener('material_property_changed', materialChanged);
			this.addEventListener("on_reset_once", () => {
				pointcloud.material.removeEventListener('material_property_changed', materialChanged);
			});
		}

		entry.addPoints(points);
		this.scene.add(entry.sceneNode);

		if (this.autoFit) { 
			let width = this.renderArea[0].clientWidth;
			let height = this.renderArea[0].clientHeight;

			let size = entry.projectedBox.getSize();

			let sx = width / size.x;
			let sy = height / size.y;
			let scale = Math.min(sx, sy);

			let center = entry.projectedBox.getCenter();
			this.scale.set(scale, scale, 1);
			this.camera.position.copy(center);
		}

		this.render();

		let numPoints = 0;
		for (let [key, value] of this.pointclouds.entries()) {
			numPoints += value.points.reduce( (a, i) => a + i.numPoints, 0);
		}
		$(`#profile_num_points`).html(Potree.utils.addCommas(numPoints));

	}

	reset () {
		this.dispatchEvent({type: "on_reset_once"});
		this.removeEventListeners("on_reset_once");

		this.autoFit = true;
		this.projectedBox = new THREE.Box3();

		this.pointclouds.clear();
		this.mouseIsDown = false;
		this.mouse.set(0, 0);
		this.scale.set(1, 1, 1);
		this.pickSphere.visible = false;

		this.scene.children
			.filter(c => c instanceof THREE.Points)
			.forEach(c => {
				this.scene.remove(c);
				c.geometry.dispose();
				c.material.dispose();
			});

		this.elRoot.find('#profileSelectionProperties').hide();

		this.render();
	}

	show () {
		this.elRoot.fadeIn();
		this.enabled = true;
	}

	hide () {
		this.elRoot.fadeOut();
		this.enabled = false;
	}

	updateScales () {
		let width = this.renderArea[0].clientWidth;
		let height = this.renderArea[0].clientHeight;

		let left = (-width / 2) / this.scale.x;
		let right = (+width / 2) / this.scale.x;
		let top = (+height / 2) / this.scale.y;
		let bottom = (-height / 2) / this.scale.y;

		this.camera.left = left;
		this.camera.right = right;
		this.camera.top = top;
		this.camera.bottom = bottom;
		this.camera.updateProjectionMatrix();

		this.scaleX.domain([this.camera.left + this.camera.position.x, this.camera.right + this.camera.position.x])
			.range([0, width]);
		this.scaleY.domain([this.camera.bottom + this.camera.position.y, this.camera.top + this.camera.position.y])
			.range([height, 0]);
	}

	render () {
		let width = this.renderArea[0].clientWidth;
		let height = this.renderArea[0].clientHeight;

		this.updateScales();

		{ // THREEJS
			let radius = Math.abs(this.scaleX.invert(0) - this.scaleX.invert(5));
			this.pickSphere.scale.set(radius, radius, radius);
			this.pickSphere.position.z = this.camera.far - radius;

			for (let [pointcloud, entry] of this.pointclouds) {
				let material = entry.sceneNode.material;
			
				material.pointColorType = pointcloud.material.pointColorType;
				material.uniforms.intensityRange.value = pointcloud.material.uniforms.intensityRange.value;
				material.heightMin = pointcloud.material.heightMin;
				material.heightMax = pointcloud.material.heightMax;
				material.rgbGamma = pointcloud.material.rgbGamma;
				material.rgbContrast = pointcloud.material.rgbContrast;
				material.rgbBrightness = pointcloud.material.rgbBrightness;
				material.intensityRange = pointcloud.material.intensityRange;
				material.intensityGamma = pointcloud.material.intensityGamma;
				material.intensityContrast = pointcloud.material.intensityContrast;
				material.intensityBrightness = pointcloud.material.intensityBrightness;
			}

			this.pickSphere.visible = false;

			this.renderer.setSize(width, height);

			this.renderer.render(this.scene, this.camera);
		}

		{ // SVG SCALES
			let marginLeft = this.renderArea[0].offsetLeft;

			this.xAxis.scale(this.scaleX)
				.orient('bottom')
				.innerTickSize(-height)
				.outerTickSize(1)
				.tickPadding(10)
				.ticks(width / 50);
			this.yAxis.scale(this.scaleY)
				.orient('left')
				.innerTickSize(-width)
				.outerTickSize(1)
				.tickPadding(10)
				.ticks(height / 20);

			d3.select('.x,axis')
				.attr('transform', `translate(${marginLeft}, ${height})`)
				.call(this.xAxis);
			d3.select('.y,axis')
				.attr('transform', `translate(${marginLeft}, 0)`)
				.call(this.yAxis);
		}
	}
};

Potree.ProfileWindowController = class ProfileWindowController {
	constructor (viewer) {
		this.viewer = viewer;
		this.profileWindow = viewer.profileWindow;
		this.profile = null;
		this.numPoints = 0;
		this.threshold = 60 * 1000;
		this.scheduledRecomputeTime = null;

		this.enabled = true;

		this.requests = [];

		this._recompute = () => { this.recompute(); };
	}

	setProfile (profile) {
		if (this.profile !== null && this.profile !== profile) {
			this.profile.removeEventListener('marker_moved', this._recompute);
			this.profile.removeEventListener('marker_added', this._recompute);
			this.profile.removeEventListener('marker_removed', this._recompute);
			this.profile.removeEventListener('width_changed', this._recompute);
		}

		this.profile = profile;

		{
			this.profile.addEventListener('marker_moved', this._recompute);
			this.profile.addEventListener('marker_added', this._recompute);
			this.profile.addEventListener('marker_removed', this._recompute);
			this.profile.addEventListener('width_changed', this._recompute);
		}

		this.recompute();
	}

	reset () {
		this.profileWindow.reset();

		this.numPoints = 0;

		if (this.profile) {
			for (let request of this.requests) {
				request.cancel();
			}
		}
	}

	progressHandler (pointcloud, progress) {
		for (let segment of progress.segments) {
			this.profileWindow.addPoints(pointcloud, segment.points);
			this.numPoints += segment.points.numPoints;
		}
	}

	cancel () {
		for (let request of this.requests) {
			request.cancel();
			// request.finishLevelThenCancel();
		}

		this.requests = [];
	};

	finishLevelThenCancel(){
		for (let request of this.requests) {
			request.finishLevelThenCancel();
		}

		this.requests = [];
	}

	recompute () {
		if (!this.profile) {
			return;
		}

		if (this.scheduledRecomputeTime !== null && this.scheduledRecomputeTime > new Date().getTime()) {
			return;
		} else {
			this.scheduledRecomputeTime = new Date().getTime() + 100;
		}
		this.scheduledRecomputeTime = null;

		this.reset();

		for (let pointcloud of this.viewer.scene.pointclouds.filter(p => p.visible)) {
			let request = pointcloud.getPointsInProfile(this.profile, null, {
				'onProgress': (event) => {
					if (!this.enabled) {
						return;
					}

					this.progressHandler(pointcloud, event.points);

					if (this.numPoints > this.threshold) {
						this.finishLevelThenCancel();
					}
				},
				'onFinish': (event) => {
					if (!this.enabled) {

					}
				},
				'onCancel': () => {
					if (!this.enabled) {

					}
				}
			});

			this.requests.push(request);
		}
	}
};
