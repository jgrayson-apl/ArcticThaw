/*
  Copyright 2020 Esri

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

define([
  "calcite",
  "dojo/_base/declare",
  "ApplicationBase/ApplicationBase",
  "dojo/i18n!./nls/resources",
  "ApplicationBase/support/itemUtils",
  "ApplicationBase/support/domHelper",
  "dojo/dom-construct",
  "esri/request",
  "esri/Color",
  "esri/identity/IdentityManager",
  "esri/core/Evented",
  "esri/core/watchUtils",
  "esri/core/promiseUtils",
  "esri/portal/Portal",
  "esri/geometry/Point",
  "esri/geometry/projection",
  "esri/geometry/SpatialReference",
  "esri/geometry/geometryEngine",
  "esri/layers/GroupLayer",
  "esri/Graphic",
  "esri/layers/GraphicsLayer",
  "esri/layers/ImageryLayer",
  "esri/layers/support/MosaicRule",
  "esri/widgets/Home",
  "esri/widgets/Search",
  "esri/widgets/Expand",
  "Application/ApplicationParameters"
], function(calcite, declare, ApplicationBase,
            i18n, itemUtils, domHelper, domConstruct,
            esriRequest, esriColor, IdentityManager, Evented,
            watchUtils, promiseUtils, Portal,
            Point, projection, SpatialReference, geometryEngine,
            GroupLayer, Graphic, GraphicsLayer, ImageryLayer, MosaicRule,
            Home, Search, Expand, ApplicationParameters){

  return declare([Evented], {

    /**
     *
     */
    constructor: function(){
      // BASE //
      this.base = null;
      // CALCITE WEB //
      calcite.init();
    },

    /**
     *
     * @param base
     */
    init: function(base){
      if(!base){
        console.error("ApplicationBase is not defined");
        return;
      }
      this.base = base;

      const webMapItems = this.base.results.webMapItems;
      const webSceneItems = this.base.results.webSceneItems;
      const validItems = webMapItems.concat(webSceneItems);
      const firstItem = (validItems && validItems.length) ? validItems[0].value : null;
      if(!firstItem){
        console.error("Could not load an item to display");
        return;
      }

      // TITLE //
      this.base.config.title = (this.base.config.title || itemUtils.getItemTitle(firstItem));
      domHelper.setPageTitle(this.base.config.title);
      document.querySelectorAll('.app-title').forEach(node => node.innerHTML = this.base.config.title);

      const viewProperties = itemUtils.getConfigViewProperties(this.base.config);
      viewProperties.container = "view-node";
      viewProperties.center = [180.0, 90.0];
      viewProperties.scale = 56411890.0;
      viewProperties.constraints = {
        snapToZoom: false,
        minScale: 112823780.0,
        maxScale: 4386589.0,
        geometry: this.base.config.constraintExtent
      };

      const portalItem = this.base.results.applicationItem.value;
      const appProxies = (portalItem && portalItem.appProxies) ? portalItem.appProxies : null;

      itemUtils.createMapFromItem({ item: firstItem, appProxies: appProxies }).then(map => {
        viewProperties.map = map;
        itemUtils.createView(viewProperties).then(view => {
          view.when(() => {
            this.viewReady(firstItem, view).then(() => {
              view.container.classList.remove("loading");
            });
          });
        });
      });
    },

    /**
     *
     * @param item
     * @param view {MapView}
     */
    viewReady: function(item, view){
      return promiseUtils.create((resolve, reject) => {
        // STARTUP DIALOG //
        this.initializeStartupDialog();

        // HOME //
        const home = new Home({ view: view });
        view.ui.add(home, { position: "top-left", index: 0 });

        // HOW-TO //
        const howToPanel = document.getElementById('how-to-panel');
        const howToExpand = new Expand({
          view: view,
          content: howToPanel,
          expanded: true,
          expandIconClass: "icon-ui-description icon-ui-flush",
          expandTooltip: "How To"
        });
        view.ui.add(howToExpand, { position: "top-left" });
        howToPanel.classList.remove('hide');

        // APPLICATION READY //
        this.applicationReady(view).then(resolve).catch(reject);

      });
    },

    /**
     *
     */
    initializeStartupDialog: function(){

      // APP NAME //
      const pathParts = location.pathname.split('/');
      const appName = `show-startup-${pathParts[pathParts.length - 2]}`;

      // STARTUP DIALOG //
      const showStartup = localStorage.getItem(appName) || 'show';
      if(showStartup === 'show'){
        calcite.bus.emit('modal:open', { id: 'app-details-dialog' });
      }

      // HIDE STARTUP DIALOG //
      const hideStartupInput = document.getElementById('hide-startup-input');
      hideStartupInput.checked = (showStartup === 'hide');
      hideStartupInput.addEventListener('change', () => {
        localStorage.setItem(appName, hideStartupInput.checked ? 'hide' : 'show');
      });

    },

    /**
     * APPLICATION READY
     *
     * @param view {MapView}
     */
    applicationReady: function(view){
      return promiseUtils.create((resolve, reject) => {

        // SHARING //
        this.initializeSharing();

        // ARCTIC BOREAL ZONE //
        this.initializeArcticBorealZone();

        // LOAD PROJECTION ENGINE //
        projection.load().then(() => {

          // LOCATION INPUT //
          this.initializeLocationInput(view);

          // LOAD IMAGERY LAYERS //
          this.loadImageryLayers(view).then(({ dataLayers, trendLayers }) => {
            //console.info(dataLayers, trendLayers);

            // TREND DURATIONS //
            this.initializeTrendDurations(view, dataLayers, trendLayers);

            // LOCATION INFOS //
            this.initializeLocationInfo(view, dataLayers, trendLayers);

            // PLACE SEARCH //
            this.initializePlaceSearch(view);

          });

        }).catch(reject);

      });
    },

    /**
     *
     * @returns {*}
     */
    loadImageryLayers: function(view){
      return promiseUtils.create((resolve, reject) => {

        // CREATE IMAGERY LAYERS AND GROUP LAYERS //
        const loadedLayersHandle = this.base.config.imageryGroupLayers.map(groupLayerInfo => {
          const groupLayer = new GroupLayer({
            ...groupLayerInfo.layerProperties,
            layers: groupLayerInfo.layers.map(layerInfo => new ImageryLayer(layerInfo))
          });
          if(groupLayer.visible){
            view.map.add(groupLayer, 0);
          }
          return groupLayer.loadAll();
        });
        Promise.all(loadedLayersHandle).then(loadedGroupLayers => {
          resolve({
            dataLayers: loadedGroupLayers[0].layers.toArray(),
            trendLayers: loadedGroupLayers[1].layers.toArray()
          });
        });

      });
    },

    /**
     *
     */
    initializeSharing: function(){

      // DEFAULT PARAMS //
      this.defaultParams = new ApplicationParameters();

      // GET URL PARAMETERS //
      if(this.base.config.trend){
        this.defaultParams.byName('trend', this.base.config.trend);
      }
      if(this.base.config.duration){
        this.defaultParams.byName('duration', Number(this.base.config.duration));
      }

      //
      // https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API
      //
      // SET SHARING URL //
      const sharePanel = document.getElementById('share-panel');
      const shareLink = document.getElementById('share-link');
      shareLink.addEventListener('click', () => {
        const shareURL = this.defaultParams.toShareURL();
        navigator.clipboard.writeText(shareURL).then(() => {
          navigator.clipboard.readText().then((clipText) => {
            //console.info("SHARE URL COPIED TO CLIPBOARD: ", clipText);
            sharePanel.classList.add('animate-in-down');
            sharePanel.classList.remove('hide');
            setTimeout(() => {
              sharePanel.classList.remove('animate-in-down');
              sharePanel.classList.add('animate-fade-out');
              setTimeout(() => {
                sharePanel.classList.remove('animate-fade-out');
                sharePanel.classList.add('hide');
              }, 1000);
            }, 2500);

          }, console.error);
        }, console.error);
      });

    },

    /**
     *
     * @param view {MapView}
     */
    initializePlaceSearch: function(view){

      // SEARCH //
      const search = new Search({
        container: 'search-container',
        view: view,
        searchTerm: this.base.config.place || ""
      });
      watchUtils.whenEqualOnce(search.viewModel, 'state', 'ready', () => {

        // UPDATE SEARCH CONFIGURATION //
        search.set({
          popupEnabled: false,
          resultGraphicEnabled: false,
          goToOverride: (view, goToParams) => { /*...*/ }
        });

        // INPUT PLACHOLDER //
        const arcgisLocator = search.defaultSources.getItemAt(0);
        arcgisLocator.placeholder = 'Enter place name or lon,lat coords';

        // SEARCH RESULT IS SELECTED //
        search.on('select-result', ({ result, source, sourceIndex }) => {
          this.defaultParams.byName('place', search.searchTerm);
          this.analyzeLocation(result.feature.geometry);
        });

        // CLEAR SEARCH //
        this.clearSearch = () => { search.searchTerm = ''; };

        // INITIAL CONFIGURED SEARCH //
        if(this.base.config.place){ search.search(); }

      });

    },

    /**
     *
     *
     */
    initializeArcticBorealZone: function(){

      // ARCTIC BOREAL ZONE VALUES BY YEAR //
      const arcticBorealZoneByYear = this.base.config.UI.arcticBorealZoneByYear;

      // TEMP MEANS //
      const tempMeans = arcticBorealZoneByYear.TempMeansByYear.map((tempMean, tempMeanIndex) => {
        return { x: 1959 + tempMeanIndex, y: tempMean };
      });

      // FROZEN DAYS //
      const frozenDays = arcticBorealZoneByYear.FrozenDaysByYear.map((frozenDays, frozenDaysIndex) => {
        return { x: 1979 + frozenDaysIndex, y: frozenDays };
      });

      this.initializeCharts({ tempMeans, frozenDays });

    },

    /**
     *
     * @param view {MapView}
     */
    initializeLocationInput: function(view){

      const latitudeSymbol = latitude => {
        return {
          type: "text",
          text: `lat: ${latitude.toFixed(2)}`,
          color: "white",
          haloColor: "rgba(36,36,36,0.6)",
          haloSize: "1px",
          xoffset: 0,
          yoffset: -18,
          font: {
            size: 13,
            weight: "bold"
          }
        };
      };

      // ANALYSIS LOCATION //
      const analysisLocationGraphic = new Graphic({
        symbol: {
          type: 'simple-marker',
          style: 'circle',
          size: '12pt',
          color: 'lime',
          outline: {
            color: 'white',
            width: '1.5pt'
          }
        }
      });
      const analysisLabelGraphic = new Graphic({
        symbol: latitudeSymbol(0.0)
      });
      const analysisLayer = new GraphicsLayer({
        effect: 'drop-shadow(3px 3px 1px #424242)',
        graphics: [analysisLocationGraphic, analysisLabelGraphic]
      });
      view.map.add(analysisLayer);

      // NORTH POLE //
      const northPole = new Point([180.0, 90.0]);
      // NORTH POLE AREA //
      const northPoleAreaGraphic = new Graphic({
        geometry: geometryEngine.geodesicBuffer(northPole, 710, 'kilometers'),
        symbol: {
          type: 'simple-fill',
          color: 'rgb(212,212,212)',
          outline: { color: 'rgba(212,212,212,0.5)', width: 10.0 }
        }
      });
      const northPoleLabelGraphic = new Graphic({
        geometry: { type: 'point', x: 180.0, y: 90.0 },
        symbol: {
          type: "text",
          text: `north\npole`,
          xoffset: 0,
          yoffset: 4,
          color: "white",
          haloColor: "rgba(36,36,36,0.8)",
          haloSize: "1px",
          font: { size: 11, weight: "bold" }
        }
      });
      const northPoleLayer = new GraphicsLayer({
        graphics: [northPoleAreaGraphic, northPoleLabelGraphic]
      });
      view.map.add(northPoleLayer, 0);


      // ANALYZE LOCATION //
      this.analyzeLocation = promiseUtils.debounce((mapPoint) => {
        return promiseUtils.create((resolve, reject) => {

          // ANALYSIS LOCATION IN WGS84 //
          const analysisLocation = projection.project(mapPoint, SpatialReference.WGS84);

          // SET PLACE //
          this.defaultParams.byName('place', `${analysisLocation.longitude.toFixed(4)},${analysisLocation.latitude.toFixed(4)}`);

          // ANALYSIS LOCATION //
          analysisLocationGraphic.set({
            geometry: mapPoint
          });
          // ANALYSIS LOCATION LABEL //
          analysisLabelGraphic.set({
            geometry: mapPoint,
            symbol: latitudeSymbol(analysisLocation.latitude)
          })

          this.getLocationInfo(analysisLocation).then(samplesInfos => {
            this.updateChartTrends(samplesInfos);
            resolve();
          }).catch(reject);

        });
      });

      view.container.style.cursor = 'pointer';
      view.on('click', clickEvt => {
        this.clearSearch();
        view.container.style.cursor = 'wait';
        this.analyzeLocation(clickEvt.mapPoint).then(() => {
          view.container.style.cursor = 'pointer';
        }).catch(error => {
          if(error.name !== 'AbortError'){
            view.container.style.cursor = 'pointer';
            console.error(error);
          }
        });
      });

    },

    /**
     *  https://developers.arcgis.com/rest/services-reference/get-samples.htm
     *
     * @param view {MapView}
     * @param dataLayers {Layer[]}
     * @param trendLayers  {Layer[]}
     */
    initializeLocationInfo: function(view, dataLayers, trendLayers){

      const _cleanNoData = value => {
        if((!Number.isNaN(value)) && (value > -1000) && (value < 1000)){
          return Number(value);
        } else {
          return Number.NaN;
        }
      };

      const _isInvalid = (values) => {
        return values.every(value => {
          return (Number.isNaN(value)) || (value === 0.0);
        });
      };

      /**
       *
       * @param location {Point}
       * @param imageryLayer {Layer}
       * @returns {Promise<{layer:Layer, samples:Object[]}[]>}
       * @private
       */
      const _getDataSamples = (location, imageryLayer) => {
        return promiseUtils.create((resolve, reject) => {

          esriRequest(`${imageryLayer.url}/getSamples`, {
            query: {
              geometry: JSON.stringify(location.toJSON()),
              geometryType: 'esriGeometryPoint',
              outFields: 'Name',
              returnFirstValueOnly: false,
              interpolation: "RSP_NearestNeighbor",
              mosaicRule: new MosaicRule(),
              f: "json"
            }
          }).then((samplesResponse) => {

            const samples = samplesResponse.data.samples.map(sample => {
              const name = sample.attributes.Name;
              const nameParts = name.split('_');
              const year = Number(nameParts[nameParts.length - 1]);
              let value = _cleanNoData(sample.value);

              return { name, year, value };
            });

            samples.sort((a, b) => (a.year - b.year));
            const isInvalid = _isInvalid(samples.map(s => s.value));

            resolve({ type: imageryLayer.title, samples: isInvalid ? null : samples });
          }).catch(error => {
            resolve({ type: imageryLayer.title, samples: null });
          });

        });
      };

      /**
       *
       * @param location {Point}
       * @param imageryLayer {Layer}
       * @returns {Promise<{layer:Layer, samples:Object[]}[]>}
       * @private
       */
      const _getTrendSamples = (location, imageryLayer) => {
        return promiseUtils.create((resolve, reject) => {

          esriRequest(`${imageryLayer.url}/getSamples`, {
            query: {
              geometry: JSON.stringify(location.toJSON()),
              geometryType: 'esriGeometryPoint',
              outFields: 'Name',
              returnFirstValueOnly: false,
              interpolation: "RSP_NearestNeighbor",
              mosaicRule: JSON.stringify(imageryLayer.mosaicRule.toJSON()),
              f: "json"
            }
          }).then((samplesResponse) => {
            const samples = samplesResponse.data.samples.map(sample => {
              const trendInfo = this.rasterNameToTrendInfo(sample.attributes.Name);
              const values = sample.value.split(' ').map(_cleanNoData);

              return {
                ...trendInfo,
                slope: values[0],
                start: values[1],
                end: values[2]
              };
            });

            resolve({ type: imageryLayer.title, samples: samples });
          }).catch(error => {
            resolve({ type: imageryLayer.title, samples: null });
          });

        });
      };

      this.getLocationInfo = (analysisLocation) => {
        return promiseUtils.create((resolve, reject) => {

          const getDataSamplesHandles = dataLayers.map(dataLayer => {
            return _getDataSamples(analysisLocation, dataLayer);
          });
          const getTrendSamplesHandles = trendLayers.map(trendLayer => {
            return _getTrendSamples(analysisLocation, trendLayer);
          });

          Promise.all([
            Promise.all(getDataSamplesHandles),
            Promise.all(getTrendSamplesHandles)
          ]).then(([dataSamples, trendSamples]) => {
            resolve({ dataSamples, trendSamples });
          }).catch(reject);

        });
      };

    },

    /**
     *
     * @param rasterName
     * @returns {{duration: number, startYear: string, endYear: string, label: string}}
     */
    rasterNameToTrendInfo: function(rasterName){
      const nameParts = rasterName.split('_');
      return {
        name: rasterName,
        startYear: Number(nameParts[1]),
        endYear: Number(nameParts[2]),
        duration: (nameParts[2] - nameParts[1]),
        label: `${nameParts[1]} to ${nameParts[2]}`
      };
    },

    /**
     *
     * @param view {MapView}
     * @param dataLayers {Layer[]}
     * @param trendLayers {Layer[]}
     */
    initializeTrendDurations: function(view, dataLayers, trendLayers){

      const trendLayersPanel = document.getElementById('trend-layers-panel');
      view.ui.add(trendLayersPanel, { position: 'bottom-left', index: 0 });
      trendLayersPanel.classList.remove('hide');

      const trendDurationsPanel = document.getElementById('trend-durations-panel');
      view.ui.add(trendDurationsPanel, { position: 'bottom-right', index: 0 });
      trendDurationsPanel.classList.remove('hide');

      // DURATION INFOS FROM TREND LAYERS //
      const trendLayersHandles = trendLayers.map(trendLayer => {
        return trendLayer.queryRasters({ where: '1=1', outFields: ['*'] }).then(rastersFS => {
          const infos = rastersFS.features.map(feature => {
            return this.rasterNameToTrendInfo(feature.attributes.Name);
          });
          return { layer: trendLayer, infos: infos }
        });
      });
      Promise.all(trendLayersHandles).then((trendLayersInfos) => {

        const trendsColorRamp = document.getElementById('trends-color-ramp');

        // SET TREND LAYER //
        const setTrendLayer = (trendLayersInfo) => {

          // TREND LAYER //
          const trendLayer = trendLayersInfo.layer;
          // TREND TYPE //
          const trendType = trendLayer.title.includes('Frozen') ? 'frozen' : 'temps';

          // SET TREND PARAM //
          this.defaultParams.byName('trend', trendLayer.title);

          // TOGGLE LAYERS VISIBILITY //
          trendLayers.forEach(otherTrendLayer => {
            otherTrendLayer.visible = (otherTrendLayer === trendLayer);
          });
          // LAYER SELECTORS //
          durationsList.querySelectorAll(`.radio-group-label`).forEach(node => {
            node.classList.toggle('btn-disabled', !node.dataset.layerid.includes(trendLayer.id));
          });

          // REVERSE COLOR RAMP //
          trendsColorRamp.classList.toggle('reverse', (trendType === 'frozen'));

          // CHART PANEL OUTLINE //
          document.querySelectorAll('.chart-panel').forEach(panel => {
            panel.classList.toggle('selected', (panel.dataset.type === trendType));
          });

          // SELECT NEXT AVAILABLE DURATION IF THE CURRENT DURATION IS NOT AVAILABLE //
          const selectedButDisabled = durationsList.querySelector(`.radio-group-input:checked + .radio-group-label.btn-disabled`);
          if(selectedButDisabled){
            const nextAvailableSelector = durationsList.querySelector('.radio-group-label:not(.btn-disabled)');
            const nextAvailableDuration = Number(nextAvailableSelector.dataset.duration);
            const nextAvailableDurationInfo = trendLayersInfo.infos.find(durationInfo => {
              return (durationInfo.duration === nextAvailableDuration);
            });
            nextAvailableSelector.previousElementSibling.checked = true;
            setDurationInfo(nextAvailableDurationInfo);
          }

        };

        // CURRENT DURATION //
        let _currentDurationInfo = null;
        this.getDurationInfo = () => { return _currentDurationInfo; }

        // SET DURATION //
        const setDurationInfo = (durationInfo) => {
          // SET CURRENT DURATION //
          _currentDurationInfo = durationInfo;

          // SET DURATION PARAM //
          this.defaultParams.byName('duration', _currentDurationInfo.duration);

          // UPDATE TREND LAYER //
          trendLayers.forEach(trendLayer => {
            trendLayer.definitionExpression = `Name LIKE '%${durationInfo.startYear}%'`;
          });

          // UPDATE THE CHARTS //
          this.updateChartTrends({});
        };

        // TREND TYPE DESCRIPTIONS //
        const trendTypeDescriptions = this.base.config.UI.trendTypeDescriptions;

        const trendsList = document.getElementById('trends-list');
        const durationsList = document.getElementById('durations-list');

        const initialDurationYears = Number(this.defaultParams.byName('duration') || 40);
        let initialTrendLayersTitle = this.defaultParams.byName('trend');
        if(initialTrendLayersTitle){
          initialTrendLayersTitle = initialTrendLayersTitle.replace(/\+/g, ' ')
        }
        const initialTrendLayersInfo = trendLayersInfos.find(trendLayersInfo => {
          return (trendLayersInfo.layer.title === initialTrendLayersTitle);
        });

        trendLayersInfos.forEach((trendLayersInfo, trendLayersInfoIndex) => {

          // LAYER SELECTORS //
          const trendLayer = trendLayersInfo.layer;
          // TREND TITLE //
          const trendLabel = (trendLayer.title === "Temp Means Trends") ? 'Air Temperature' : 'Frozen Ground'

          // TREND LAYER SELECTORS //
          domConstruct.create('input', {
            id: `trend-${trendLayer.id}`,
            name: `trend-layer`,
            className: 'radio-group-input',
            type: 'radio',
            checked: initialTrendLayersInfo ? (initialTrendLayersInfo.layer.title === trendLayer.title) : (trendLayersInfoIndex === 0)
          }, trendsList);

          const trendLabelNode = domConstruct.create('label', {
            for: `trend-${trendLayer.id}`,
            className: 'radio-group-label',
            innerHTML: trendLabel
          }, trendsList);
          trendLabelNode.addEventListener('click', evt => {
            setTrendLayer(trendLayersInfo);
          });

          const detailsNode = domConstruct.create('span', {
            className: 'right tooltip tooltip-top tooltip-multiline',
            'aria-label': trendTypeDescriptions[trendLabel]
          }, trendLabelNode);
          domConstruct.create('span', {
            className: 'icon-ui-description icon-ui-flush margin-left-half'
          }, detailsNode);

          trendLayersInfo.infos.forEach((durationInfo) => {

            let durationLabel = durationsList.querySelector(`.radio-group-label[data-duration="${durationInfo.duration}"]`);
            if(!durationLabel){

              // TREND DURATION SELECTORS //
              domConstruct.create('input', {
                id: `duration-${trendLayer.id}-${durationInfo.duration}`,
                //name: `duration-${trendLayer.id}`,
                name: `trend-duration`,
                className: 'radio-group-input',
                type: 'radio',
                checked: (durationInfo.duration === initialDurationYears)
              }, durationsList);
              durationLabel = domConstruct.create('label', {
                'data-layerid': trendLayer.id,
                'data-duration': durationInfo.duration,
                for: `duration-${trendLayer.id}-${durationInfo.duration}`,
                className: 'radio-group-label tooltip tooltip-left',
                "aria-label": durationInfo.label,
                innerHTML: `${durationInfo.duration} yrs`
              }, durationsList);
              durationLabel.addEventListener('click', evt => {
                setDurationInfo(durationInfo);
              });

              if(durationInfo.duration === initialDurationYears){
                setDurationInfo(durationInfo);
              }
            } else {
              durationLabel.setAttribute('data-layerid', [durationLabel.dataset.layerid, trendLayer.id].join("|"));
            }
          });

        });

        if(initialTrendLayersInfo){
          setTrendLayer(initialTrendLayersInfo);
        }
      });

    },

    /**
     *
     */
    initializeCharts: function({ tempMeans, frozenDays }){

      Chart.defaults.font.family = "'Avenir Next LT Pro', 'Avenir Next', 'Helvetica Nue', 'Helvetica', sans-serif";
      Chart.defaults.font.style = 'normal';
      Chart.defaults.font.size = 11;
      Chart.defaults.color = '#f2f2f2';

      const defaultTitle = {
        display: true,
        font: { style: 'normal', size: 18 }
      };

      const defaultGridLines = {
        color: '#666666',
        zeroLineColor: '#999999',
        drawBorder: true
      };

      const defaultDatasets = {
        'trend': {
          label: 'Trend',
          type: 'line',
          borderDash: [16, 8],
          borderWidth: 3.3,
          borderColor: 'white',
          pointBackgroundColor: 'lime',
          pointBorderColor: 'white',
          pointRadius: 7.5,
          hoverRadius: 7.5,
          pointBorderWidth: 1.5,
          hoverBorderWidth: 1.5,
          fill: false
        },
        'user': {
          label: 'Analysis Location',
          type: 'line',
          spanGaps: false,
          cubicInterpolationMode: 'monotone',
          borderWidth: 1.8,
          pointRadius: 4.5,
          hoverRadius: 4.5,
          pointBackgroundColor: 'white',
          pointBorderWidth: 1.5,
          hoverBorderWidth: 1.5,
          fill: false
        },
        'arctic': {
          label: 'Arctic Boreal Zone',
          type: 'line',
          cubicInterpolationMode: 'monotone',
          borderColor: '#dedede',
          borderWidth: 1.5,
          pointRadius: 4.5,
          hoverRadius: 4.5,
          pointBorderColor: 'white',
          pointBorderWidth: 1.2,
          hoverBorderWidth: 1.2,
          pointStyle: 'rect',
          fill: false
        }
      };

      const defaultLegend = {
        display: true,
        onClick: null,
        labels: {
          boxWidth: 9,
          usePointStyle: true
        }
      };

      const defaultTooltip = {
        mode: 'point',
        intersect: true,
        position: 'nearest',
        backgroundColor: '#ffffff',
        borderWidth: 0.5,
        borderColor: '#666666',
        titleColor: '#424242',
        titleFont: { size: 15 },
        titleAlign: 'center',
        titleMarginBottom: 10,
        bodyFont: { size: 13 },
        bodyColor: '#424242',
        bodySpacing: 8
      }

      // CREATE CHART //
      const tempMeansThemeColor = '#fa3817';
      const tempsChartNode = document.getElementById('temp-means-chart-node');
      const temperaturesChart = new Chart(tempsChartNode, {
        data: {
          datasets: [
            {
              ...defaultDatasets.trend,
              data: []
            },
            {
              ...defaultDatasets.user,
              borderColor: tempMeansThemeColor,
              pointBorderColor: tempMeansThemeColor,
              data: []
            },
            {
              ...defaultDatasets.arctic,
              pointBackgroundColor: tempMeansThemeColor,
              data: tempMeans
            }
          ]
        },
        options: {
          responsive: true,
          animation: false,
          maintainAspectRatio: false,
          plugins: {
            title: {
              ...defaultTitle,
              text: 'Air Temperature - 1959 to 2019'
            },
            legend: defaultLegend,
            tooltip: {
              ...defaultTooltip,
              callbacks: {
                title: function(tooltipItems){
                  if(tooltipItems[0].datasetIndex > 0){
                    return `Average Temperature in ${tooltipItems[0].parsed.x.toFixed(0)}`;
                  } else {
                    const startYear = tooltipItems[0].dataset.data[0].x;
                    const endYear = tooltipItems[0].dataset.data[1].x;
                    return `Average Temperature - ${startYear} to ${endYear}`;
                  }
                },
                label: function(tooltipItem){
                  const datasetLabel = tooltipItem.dataset.label;
                  if(tooltipItem.datasetIndex > 0){
                    return ` ${datasetLabel}: ${Number(tooltipItem.formattedValue).toFixed(2)}° C`;
                  } else {
                    return datasetLabel;
                  }
                }
              }
            }
          },
          scales: {
            y: {
              type: "linear",
              display: true,
              scaleLabel: {
                display: true,
                labelString: 'Temperature °C',
                fontSize: 15
              },
              ticks: {
                padding: 5,
                precision: 0,
                callback: function(value, index, values){ return `${value.toFixed(1)}°`; }
              },
              grid: defaultGridLines
            },
            x: {
              type: 'linear',
              position: 'bottom',
              scaleLabel: {
                display: false,
                labelString: 'Years',
                fontSize: 15
              },
              ticks: {
                padding: 5,
                min: 1955,
                max: 2025
              },
              grid: defaultGridLines
            }
          }
        }
      });

      //
      // FROZEN DAYS
      //
      const frozenDaysThemeColor = '#439bff';
      const frozenDaysChartNode = document.getElementById('frozen-days-chart-node');
      const frozenDaysChart = new Chart(frozenDaysChartNode, {
        data: {
          datasets: [
            {
              ...defaultDatasets.trend,
              data: []
            },
            {
              ...defaultDatasets.user,
              borderColor: frozenDaysThemeColor,
              pointBorderColor: frozenDaysThemeColor,
              data: []
            },
            {
              ...defaultDatasets.arctic,
              pointBackgroundColor: frozenDaysThemeColor,
              data: frozenDays
            }
          ]
        },
        options: {
          responsive: true,
          animation: false,
          maintainAspectRatio: false,
          plugins: {
            title: {
              ...defaultTitle,
              text: 'Frozen Ground - 1979 to 2019'
            },
            legend: defaultLegend,
            tooltip: {
              ...defaultTooltip,
              callbacks: {
                title: function(tooltipItems){
                  if(tooltipItems[0].datasetIndex > 0){
                    return `Frozen Days in ${tooltipItems[0].parsed.x.toFixed(0)}`;
                  } else {
                    const startYear = tooltipItems[0].dataset.data[0].x;
                    const endYear = tooltipItems[0].dataset.data[1].x;
                    return `Frozen Days - ${startYear} to ${endYear}`;
                  }
                },
                label: function(tooltipItem){
                  const datasetLabel = tooltipItem.dataset.label;
                  if(tooltipItem.datasetIndex > 0){
                    return ` ${datasetLabel}: ${Math.round(tooltipItem.formattedValue)} days`;
                  } else {
                    return datasetLabel;
                  }
                }
              }
            }
          },
          scales: {
            y: {
              type: "linear",
              display: true,
              scaleLabel: {
                display: true,
                labelString: 'Number of Frozen Days',
                fontSize: 15
              },
              ticks: {
                padding: 5,
                precision: 0
              },
              grid: defaultGridLines
            },
            x: {
              type: 'linear',
              position: 'bottom',
              scaleLabel: {
                display: false,
                labelString: 'Years',
                fontSize: 15
              },
              ticks: {
                padding: 5,
                min: 1975,
                max: 2025
              },
              grid: defaultGridLines
            }
          }
        }
      });

      // ABZ TREND VALUES //
      const arcticBorealZoneTrends = this.base.config.UI.arcticBorealZoneTrends;

      // TREND VALUE LABELS //
      const diffTempAbzValue = document.getElementById('diff-temp-abz-value');
      const diffTempLocValue = document.getElementById('diff-temp-loc-value');
      const diffFrozenAbzValue = document.getElementById('diff-frozen-abz-value');
      const diffFrozenLocValue = document.getElementById('diff-frozen-loc-value');

      /**
       * UPDATE DATA AND TREND LABELS
       *
       * @param dataSamples
       * @param trendSamples
       */

      let _dataSamples = null;
      let _trendSamples = null;
      this.updateChartTrends = ({ dataSamples, trendSamples }) => {
        _trendSamples = trendSamples || _trendSamples;
        _dataSamples = dataSamples || _dataSamples;

        if(_trendSamples){
          // DURATION INFO //
          const durationInfo = this.getDurationInfo();
          // TREND SAMPLES //
          _trendSamples.forEach(trendSample => {

            // GET SAMPLE FOR CURRENT TREND //
            const sample = (trendSample.samples && trendSample.samples.length)
              ? trendSample.samples.find(sample => sample.duration === durationInfo.duration)
              : null;

            // TREND //
            const trend = sample
              ? [{ x: sample.startYear, y: sample.start, slope: sample.slope },
                { x: sample.endYear, y: sample.end, slope: sample.slope }]
              : null;

            switch(trendSample.type){
              case 'Temp Means Trends':

                const tempTrendValue = trend ? (trend[0].slope * 10.0).toFixed(2) : null;
                const tempABZTrendValue = trend ? (arcticBorealZoneTrends[trendSample.type][trend[0].x]).toFixed(2) : null;

                temperaturesChart.data.datasets[0].data = trend || null;
                temperaturesChart.data.datasets[0].label = trend ? `Trend: ${tempTrendValue}° C per decade` : 'Trend';

                diffTempAbzValue.innerHTML = tempABZTrendValue ? `${tempABZTrendValue}°` : '&nbsp;';
                diffTempLocValue.innerHTML = tempTrendValue ? `${tempTrendValue}°` : '&nbsp;';

                break;
              case 'Frozen Days Trends':

                const frozenTrendValue = trend ? (trend[0].slope * 10.0).toFixed(2) : null;
                const frozenABZTrendValue = trend ? (arcticBorealZoneTrends[trendSample.type][trend[0].x]).toFixed(2) : null;

                frozenDaysChart.data.datasets[0].data = trend || null;
                frozenDaysChart.data.datasets[0].label = trend ? `Trend: ${frozenTrendValue} days per decade` : 'Trend';

                diffFrozenAbzValue.innerHTML = frozenABZTrendValue || '&nbsp;';
                diffFrozenLocValue.innerHTML = frozenTrendValue || '&nbsp;';

                break;
            }
          });
        }

        if(_dataSamples){
          // DATA SAMPLES //
          _dataSamples.forEach(dataSample => {

            const data = (dataSample.samples && dataSample.samples.length)
              ? dataSample.samples.map(sample => { return { x: sample.year, y: sample.value }; })
              : null;

            switch(dataSample.type){
              case 'Temp Means ByYear':
                temperaturesChart.data.datasets[1].data = data || null;
                break;
              case 'Frozen Days ByYear':
                frozenDaysChart.data.datasets[1].data = data || null;
                break;
            }
          });
        }

        temperaturesChart.update();
        frozenDaysChart.update();
      };

      // RESIZE CHART WHEN PARENT ELEMENT IS RESIZED //
      const chartParentObserver = new ResizeObserver(entries => {
        entries.forEach(entry => {
          temperaturesChart.resize();
          frozenDaysChart.resize();
        });
      });
      chartParentObserver.observe(document.getElementById('left-container'));

    }

  });
});
