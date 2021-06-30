/* eslint-disable no-return-assign */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-prototype-builtins */
import * as L from "leaflet";
import "leaflet-draw";
import React, { Component } from "react";
import {
  Card,
  HotkeysTarget,
  Hotkey,
  Hotkeys,
  Button,
  ProgressBar,
  Toaster,
  IToastProps,
  Icon,
  Intent,
} from "@blueprintjs/core";

import {
  PolylineObjectType,
  RenderAssetAnnotations,
} from "@portal/components/annotations/utils/annotation";

import {
  AssetAPIObject,
  APIGetInferenceFlask,
  APIGetImageData,
  APIGetAsset,
  APIGetVideoPrediction,
  APIGetModelTags,
} from "@portal/api/annotation";

import { invert, cloneDeep } from "lodash";

import { CreateGenericToast } from "@portal/utils/ui/toasts";
import AnnotatorInstanceSingleton from "./utils/annotator.singleton";
import AnnotationMenu from "./menu";
import ImageBar from "./imagebar";
import SettingsModal from "./settingsmodal";
import FileModal from "./filemodal";
import AnnotatorSettings from "./utils/annotatorsettings";
import { RegisteredModel } from "./model";

type Point = [number, number];
type MapType = L.DrawMap;
type VideoFrameMetadata = {
  presentationTime: DOMHighResTimeStamp;
  expectedDisplayTime: DOMHighResTimeStamp;
  width: number;
  height: number;
  mediaTime: number;
  presentedFrames: number;
  processingDuration: number;

  captureTime: DOMHighResTimeStamp;
  receiveTime: DOMHighResTimeStamp;
  rtpTimestamp: number;
};

/**
 * Enumeration for Existing User Selected Edit Mode
 */
type EditState = "None" | "Open Folder" | "Re-Analyse" | "Bulk Analysis";

function Coordinate(x: number, y: number): Point {
  /* Coordinate Space Resolver */

  return [x, y];
}

type UIState = null | "Predicting";

interface AnnotatorProps {
  project: string;
  user: any;
  useDarkTheme: boolean;
  loadedModel: RegisteredModel | undefined;
}

interface AnnotatorState {
  /* Image List for Storing Project Files */
  assetList: Array<AssetAPIObject>;
  /* Tags for Project */
  tagInfo: {
    modelHash: string | undefined;
    tags: { [tag: string]: number } | any;
  };
  /* Changes Made Flag - For Firing Save Button Availability */
  changesMade: boolean;
  /* Current User Editing Mode */
  userEditState: EditState;
  /* File Management Mode */
  fileManagementOpen: boolean;
  /* Tag Management Mode */
  advancedSettingsOpen: boolean;
  /* Image List Collapse Mode */
  imageListCollapsed: boolean;
  /* Hide annotated images in imagebar */
  annotatedAssetsHidden: boolean;
  /* Set of IDs of hidden annotations */
  hiddenAnnotations: Set<string>;
  /* Is Annotator Predicting? */
  uiState: UIState;
  /* Total number of items and those predicted */
  predictTotal: number;
  predictDone: number;
  multiplier: number;
  /* Confidence */
  confidence: number;
  /* Can't be polyline object type due to confidence attribute */
  currentAssetAnnotations: any;
  /* Filter state to filter out tag labels */
  filterArr: Array<string>;
  /* Choose whether to show or hide selected labels */
  showSelected: boolean;
  /* Metadata related to inference */
  inferenceOptions: {
    /* Intersection over Union */
    iou: number;
    cacheResults: boolean;
    video: {
      /* Frame interval to produce predictions for video */
      frameInterval: number;
    };
  };
  /* Utility to toggle existing annotations */
  annotationOptions: {
    isOutlined: true;
    opacity: number;
  };
  currAnnotationPlaybackId: number;
}

/**
 * Annotations are Leaflet layers with additional
 * editing and options properties
 */
interface AnnotationLayer extends L.Layer {
  editing: any;
  options: any;
}

/**
 * This Annotator class is a super class of the annotator controls, image select
 * as well as the leaflet map for annotation drawing.
 */
@HotkeysTarget
export default class Annotator extends Component<
  AnnotatorProps,
  AnnotatorState
> {
  /* Class Variables */
  public map!: MapType;
  private imageOverlay!: L.ImageOverlay;
  private videoOverlay!: L.VideoOverlay;
  private annotationGroup!: L.FeatureGroup;

  /* Project Properties */
  private project: string;
  private annotatedAssets: number;

  /* Component Reference */
  private imagebarRef: any;

  /* Annotation Operations Variables */
  public currentAsset: AssetAPIObject;
  /**
   * Current Tag is read on SetAnnotationTag. this is an unwanted side-effect but
   * Is used to overcome the unused-vars. This is still an important state though
   * so it is being kept here.
   */
  private currentTag: number;
  private menubarRef: React.RefObject<AnnotationMenu>;
  private menubarElement: HTMLElement | undefined;
  private selectedAnnotation: AnnotationLayer | null;

  /* States for Toaster */
  private toaster: Toaster;
  private progressToastInterval?: number;
  private refHandlers = {
    toaster: (ref: Toaster) => (this.toaster = ref),
  };

  /* Reference to background Image or Video */
  backgroundImg: HTMLElement | null;

  constructor(props: AnnotatorProps) {
    super(props);

    this.state = {
      currentAssetAnnotations: [],
      userEditState: "None",
      changesMade: false,
      assetList: [],
      tagInfo: {
        modelHash: undefined,
        tags: {},
      },
      fileManagementOpen: false,
      advancedSettingsOpen: false,
      imageListCollapsed: false,
      annotatedAssetsHidden: false,
      hiddenAnnotations: new Set<string>(),
      uiState: null,
      predictTotal: 0,
      predictDone: 0,
      multiplier: 1,
      confidence: 0.5,
      annotationOptions: {
        isOutlined: true,
        opacity: 0.3,
      },
      filterArr: [],
      showSelected: true,
      inferenceOptions: {
        cacheResults: false,
        iou: 0.8,
        video: {
          frameInterval: 20,
        },
      },
      currAnnotationPlaybackId: 0,
    };

    this.toaster = new Toaster({}, {});
    this.progressToastInterval = 600;

    this.currentTag = 0;
    this.project = this.props.project;
    this.menubarRef = React.createRef();
    this.menubarElement = undefined;

    /* Placeholder Value for Initialization */
    this.currentAsset = {} as AssetAPIObject;
    this.annotatedAssets = 0;
    this.selectedAnnotation = null;

    this.annotationGroup = new L.FeatureGroup();

    /* Image Bar Reference to Track Which Image is Selected */
    this.imagebarRef = React.createRef();
    this.backgroundImg = null;

    this.selectAsset = this.selectAsset.bind(this);
    this.showToaster = this.showToaster.bind(this);
    this.renderProgress = this.renderProgress.bind(this);
    this.getInference = this.getInference.bind(this);
    this.updateAnnotations = this.updateAnnotations.bind(this);

    this.resetControls = this.resetControls.bind(this);

    this.refreshProject = this.refreshProject.bind(this);
    this.setAnnotationTag = this.setAnnotationTag.bind(this);
    this.switchAnnotation = this.switchAnnotation.bind(this);
    this.handleFileManagementOpen = this.handleFileManagementOpen.bind(this);
    this.handleFileManagementClose = this.handleFileManagementClose.bind(this);
    this.handleAdvancedSettingsOpen = this.handleAdvancedSettingsOpen.bind(
      this
    );
    this.handleAdvancedSettingsClose = this.handleAdvancedSettingsClose.bind(
      this
    );
    this.handlePlayPauseVideoOverlay = this.handlePlayPauseVideoOverlay.bind(
      this
    );
    this.updateImage = this.updateImage.bind(this);

    this.setAnnotationVisibility = this.setAnnotationVisibility.bind(this);
    this.setAllAnnotationVisibility = this.setAllAnnotationVisibility.bind(
      this
    );
    this.filterAnnotationVisibility = this.filterAnnotationVisibility.bind(
      this
    );
    this.setAnnotationOutline = this.setAnnotationOutline.bind(this);
    this.setAnnotationOpacity = this.setAnnotationOpacity.bind(this);
    this.toggleShowSelected = this.toggleShowSelected.bind(this);
    this.setAnnotatedAssetsHidden = this.setAnnotatedAssetsHidden.bind(this);
  }

  async componentDidMount(): Promise<void> {
    this.menubarElement = document.getElementById("image-bar") as HTMLElement;

    /* Attach Listeners for Translating Vertical to Horizontal Scroll */
    this.menubarElement.addEventListener(
      "onwheel" in document ? "wheel" : "mousewheel",
      this.handleVerticalScrolling
    );

    /* Implicit rR Loading for Leaflet */
    this.map = L.map("annotation-map", {
      scrollWheelZoom: true,
      zoomAnimation: false,
      zoomDelta: 0,
      zoomSnap: 0,
      minZoom: -3,
      maxZoom: 3,
      crs: L.CRS.Simple,
      attributionControl: false,
      zoomControl: false,
      doubleClickZoom: false,
    }).setView(Coordinate(5000, 5000), 0);

    this.annotationGroup.addTo(this.map);

    this.map.on("mouseup", () => {
      if (this.videoOverlay) {
        const videoElement = this.videoOverlay.getElement();
        if (videoElement !== document.activeElement) {
          videoElement?.focus();
        }
      }
    });

    const imageUrl = "";
    const imageBounds = [Coordinate(30000, 0), Coordinate(0, 23000)];
    /* Render First Image */
    this.imageOverlay = L.imageOverlay(imageUrl, imageBounds);
    this.videoOverlay = L.videoOverlay(imageUrl, imageBounds, {
      interactive: true,
    });

    /**
     * Setup Singleton Instance to Annotator and Map
     */
    // eslint-disable-next-line no-new
    new AnnotatorInstanceSingleton(this.map, this);

    setTimeout(() => this.updateImage(), 200);
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  componentDidUpdate() {
    /* Obtain Tag Map for loaded Model */
    /* The conditional checks are necessary due to the use of setStates */
    if (
      this.props.loadedModel &&
      this.props.loadedModel.hash !== this.state.tagInfo.modelHash
    ) {
      APIGetModelTags(this.props.loadedModel.hash)
        .then(result => {
          const tagInfo = {
            modelHash: this.props.loadedModel?.hash,
            tags: result.data,
          };
          this.setState({
            tagInfo,
            advancedSettingsOpen: false,
          });
          if (Object.keys(this.state.tagInfo.tags).length > 0) {
            this.currentTag = 0;
          }

          (this.annotationGroup as any).tags = this.state.tagInfo.tags;
        })
        .catch(error => {
          let message = `Failed to obtain loaded model tags. ${error}`;
          if (error.response) {
            message = `${error.response.data.error}: ${error.response.data.message}`;
          }

          CreateGenericToast(message, Intent.DANGER, 3000);
        });
    }

    if (!this.props.loadedModel && this.state.tagInfo.modelHash !== undefined) {
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({
        tagInfo: {
          modelHash: undefined,
          tags: {},
        },
      });
      (this.annotationGroup as any).tags = this.state.tagInfo.tags;
    }
  }

  componentWillUnmount(): void {
    /* Check if Menubar Targetted */
    if (this.menubarElement !== undefined)
      this.menubarElement.removeEventListener(
        "onwheel" in document ? "wheel" : "mousewheel",
        this.handleVerticalScrolling
      );
  }

  private handlePlayPauseVideoOverlay() {
    const videoElement = this.videoOverlay?.getElement();

    if (videoElement) {
      if (videoElement.onplaying) {
        if (videoElement.paused) {
          videoElement.play();
        } else {
          videoElement.pause();
        }
      }
    }
  }

  private handleAdvancedSettingsClose() {
    this.setState({ advancedSettingsOpen: false });
  }
  private handleAdvancedSettingsOpen() {
    this.setState({ advancedSettingsOpen: true });
  }

  private handleFileManagementClose() {
    this.setState({ fileManagementOpen: false });
  }
  private handleFileManagementOpen() {
    this.setState({ fileManagementOpen: true });
  }

  /* Handler for Converting Vertical Scroll to Horizontal Scroll */
  private handleVerticalScrolling = (e: any) => {
    const dist = e.deltaY * 1.5;
    /* Check if Targeted */
    if (this.menubarElement !== undefined)
      this.menubarElement.scrollLeft += dist;
  };

  /**
   * Setting of User State
   */
  private setUserState(state: EditState) {
    if (this.state.userEditState === state) return;

    if (state === "None") {
      this.setState({ userEditState: state });
      return;
    }

    this.resetControls();
    this.setState({ userEditState: state });
  }

  public setAnnotationTag(tagIndex: number): number {
    this.currentTag = tagIndex;
    return this.currentTag;
  }

  private setAnnotationOpacity(value: number): void {
    this.setState(
      prevState => {
        const config = prevState.annotationOptions;
        config.opacity = value;
        return { annotationOptions: config };
      },
      () => this.filterAnnotationVisibility()
    );
  }

  private setAnnotationOutline(isReset: boolean): void {
    this.setState(
      prevState => {
        const config = prevState.annotationOptions;
        config.isOutlined = isReset
          ? true
          : (!prevState.annotationOptions.isOutlined as any);

        return { annotationOptions: config };
      },
      () => this.filterAnnotationVisibility()
    );
  }

  /**
   * Set selected annotation to new annotation
   * @param annotation - annotation layer to be selected
   */
  public setSelectedAnnotation(annotation: AnnotationLayer | null): void {
    /* Deselect previous annotation */
    if (this.selectedAnnotation) {
      this.selectedAnnotation.options.fillOpacity = 0.35;
      this.selectedAnnotation.fire("mouseout");
    }

    /* Select new annotation */
    this.selectedAnnotation = annotation;
    if (this.selectedAnnotation) {
      /* If annotation not null, enable editing */
      this.selectedAnnotation.options.fillOpacity = 0.7;
    }

    /* Update selected annotation on menubar */
    if (this.menubarRef.current !== null)
      this.menubarRef.current.setSelectedAnnotation(annotation);
  }

  /**
   * Show or hide a list of annotations.
   * @param visible - set true to show annotations, false to hide annotations
   * @param annotationList -  list of target annotations
   */
  public setAnnotationVisibility(
    visible: boolean,
    ...annotationList: any[]
  ): void {
    this.setState(prevState => {
      const hiddenAnnotations = new Set<string>(prevState.hiddenAnnotations);
      annotationList.forEach(annotation => {
        if (visible) {
          this.map.addLayer(annotation);
          hiddenAnnotations.delete(annotation.options.annotationID);
        } else {
          this.map.removeLayer(annotation);
          hiddenAnnotations.add(annotation.options.annotationID);
        }
      });
      return { hiddenAnnotations };
    });
  }

  /**
   * Show or hide all annotations in annotationGroup.
   * @param visible - set true to show annotations, false to hide annotations
   */
  public setAllAnnotationVisibility(visible: boolean): void {
    /* Hide all annotations */
    if (visible) {
      this.map.addLayer(this.annotationGroup);
      /* Clear hidden annotations */
      this.setState({ hiddenAnnotations: new Set() });
    } else {
      this.map.removeLayer(this.annotationGroup);
      /* Set of all annotation IDs in annotationGroup */
      this.setState({
        hiddenAnnotations: new Set<string>(
          Object.values((this.annotationGroup as any)._layers).map(
            (annotation: any) => annotation.options.annotationID as string
          )
        ),
      });
    }
  }

  /**
   * Set image bar to either show thumbnails for all assets,
   * or only assets that are unannotated
   * @param flag - Whether to show only unannotated thumbnails
   */
  public setAnnotatedAssetsHidden(flag: boolean): void {
    this.setState({ annotatedAssetsHidden: flag });
  }

  private getInference() {
    if (this.state.predictDone !== 0 || this.state.uiState === "Predicting") {
      CreateGenericToast("Inference is already running", Intent.WARNING, 3000);
      return;
    }

    if (!this.props.loadedModel) {
      CreateGenericToast("There is no model loaded", Intent.WARNING, 3000);
      return;
    }

    const loadedModelHash = this.props.loadedModel.hash;

    this.setState({ predictTotal: 100, predictDone: 0.01, multiplier: 1 });
    this.setState({ uiState: "Predicting" });
    this.handleProgressToast();

    setTimeout(async () => {
      if (this.currentAsset.type === "image") {
        await APIGetInferenceFlask(
          loadedModelHash,
          this.currentAsset.localPath,
          this.state.inferenceOptions.iou,
          "json"
        )
          .then(response => {
            this.updateAnnotations(response.data);
          })
          .catch(error => {
            let message = `Failed to predict image. ${error}`;
            if (error.response) {
              message = `${error.response.data.error}: ${error.response.data.message}`;
            }

            CreateGenericToast(message, Intent.DANGER, 3000);
          });
      }

      if (this.currentAsset.type === "video") {
        await APIGetVideoPrediction(
          loadedModelHash,
          this.currentAsset.localPath,
          this.state.inferenceOptions.video.frameInterval,
          this.state.inferenceOptions.iou
        )
          .then(response => {
            const videoElement = this.videoOverlay.getElement();
            const videoFrameCallback = (
              now: DOMHighResTimeStamp,
              metadata: VideoFrameMetadata
            ) => {
              const secondsInterval =
                this.state.inferenceOptions.video.frameInterval /
                response.data.fps;
              const quotient = Math.floor(metadata.mediaTime / secondsInterval);

              const key = Math.floor(
                quotient * secondsInterval * 1000
              ).toString();

              if (response.data.frames[key]) {
                this.updateAnnotations(response.data.frames[key]);
              }

              const id = (videoElement as any).requestVideoFrameCallback(
                videoFrameCallback
              );
              this.setState({ currAnnotationPlaybackId: id });
            };

            if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
              (videoElement as any).requestVideoFrameCallback(
                videoFrameCallback
              );
            }
          })
          .catch(error => {
            let message = `Failed to predict video. ${error}`;
            if (error.response) {
              message = `${error.response.data.error}: ${error.response.data.message}`;
            }

            CreateGenericToast(message, Intent.DANGER, 3000);
          });
      }

      this.setState({ predictDone: 0, uiState: null });
    }, 0);
  }

  private updateAnnotations = (annotations: any) => {
    const res = {
      metadata: this.currentAsset.metadata,
      url: this.currentAsset.url,
      filename: this.currentAsset.filename,
      assetUrl: this.currentAsset.assetUrl,
      annotations,
      thumbnailUrl: this.currentAsset.thumbnailUrl,
      localPath: this.currentAsset.localPath,
      type: this.currentAsset.type,
      /* useless properties but deleting them will cause lots
      of type conflicts. decided to use dummy values instead
      */
    };

    const currentAssetAnnotations: Array<PolylineObjectType> = RenderAssetAnnotations(
      this.map,
      this.annotationGroup,
      res,
      this.project,
      this.currentAsset.metadata.width,
      this.currentAsset.metadata.height,
      // eslint-disable-next-line react/no-access-state-in-setstate
      this.state.tagInfo.tags
    );

    this.annotationGroup.clearLayers();

    currentAssetAnnotations.forEach(annotation => {
      this.annotationGroup.addLayer(annotation);
    });

    this.setState({
      currentAssetAnnotations,
    });

    /* Update menu bar annotations */
    this.updateMenuBarAnnotations();
    /* Show all annotations */
    this.filterAnnotationVisibility();
  };

  private updateImage = () => {
    /* Get All Existing Registered Folder and Image Assets */
    APIGetAsset().then(res => {
      /* Generate New Asset List Based on Updated Data */
      const newImageAssets = res.data.map((encodedUri: string) => {
        const decodedUri = decodeURIComponent(encodedUri);
        let seperator = "/";
        let type = "image";
        if (decodedUri.includes("\\")) seperator = "\\";
        if (decodedUri.match(/\.(?:mov|mp4|wmv)/i)) type = "video";
        return {
          filename: decodedUri.split(seperator).pop(),
          assetUrl: APIGetImageData(encodedUri),
          thumbnailUrl: APIGetImageData(encodedUri),
          localPath: encodedUri,
          type,
        };
      });

      this.setState({ assetList: newImageAssets });
    });
  };

  private setFilterArr = (values: Array<string>) => {
    this.setState({ filterArr: values }, () => {
      this.filterAnnotationVisibility();
    });
  };

  private toggleShowSelected = () => {
    this.setState(
      prevState => {
        return {
          showSelected: !prevState.showSelected,
        };
      },
      () => {
        this.filterAnnotationVisibility();
      }
    );
  };

  private toggleConfidence = (value: number) => {
    /* Set Confidence Value based on Slider moving */
    this.setState({ confidence: value / 100 }, () => {
      this.filterAnnotationVisibility();
    });
  };

  private handleChangeInAdvancedSettings = (value: any, key: string) => {
    this.setState(prevState => {
      const settings = prevState.inferenceOptions;
      if (key === "frameInterval") {
        settings.video.frameInterval = value;
      }
      if (key === "iou") {
        settings.iou = value;
      }
      return { inferenceOptions: settings };
    });
  };

  /**
   * Increments the selected asset by 1 according to the left or right keys
   * @param left - Returns true for left key and false for right key
   */
  private switchAnnotation = (left: boolean) => {
    /**
     * Filter currently visible assets based on current settings
     * Only visible assets can be selected
     */
    const visibleAssets = this.state.assetList.filter((_: any) =>
      this.isAssetVisible()
    );

    const currentIndex = visibleAssets.findIndex(
      asset => asset.assetUrl === this.currentAsset.assetUrl
    );

    /* Aborts function if the direction of increment is out of bounds */
    if (
      (left && currentIndex <= 0) ||
      (!left && currentIndex >= visibleAssets.length - 1)
    ) {
      return;
    }

    const shift = left ? -1 : 1;
    const newIndex = Math.min(
      Math.max(0, currentIndex + shift),
      visibleAssets.length - 1
    );

    this.selectAsset(visibleAssets[newIndex]);

    /* Reset selected annotation */
    this.setSelectedAnnotation(null);

    const imageBar = document.getElementById("image-bar");
    if (imageBar !== null) {
      imageBar.scrollLeft += shift * 120;
    }
  };

  private handleProgressToast = () => {
    const key = this.toaster.show(this.renderProgress(0));
    this.progressToastInterval = window.setInterval(() => {
      if (
        this.state.uiState === null ||
        this.state.predictDone === this.state.predictTotal
      ) {
        this.toaster.show(this.renderProgress(100), key);
        window.clearInterval(this.progressToastInterval);
      } else {
        /* Need to shift this over later */
        const addRand = (Math.random() * 20) / this.state.multiplier;
        if (this.state.predictDone + addRand < this.state.predictTotal * 0.98)
          this.setState(prevState => {
            return {
              predictDone: prevState.predictDone + addRand,
              multiplier: prevState.multiplier + 0.2,
            };
          });
        const donePercent =
          (this.state.predictDone / this.state.predictTotal) * 100;
        this.toaster.show(this.renderProgress(donePercent), key);
      }
    }, 200);
  };

  private showToaster(toast: IToastProps) {
    this.toaster.show(toast);
  }

  private filterAnnotationVisibility(): void {
    /* Clear Annotation Layer */
    this.annotationGroup.clearLayers();
    const invertedProjectTags = invert(this.state.tagInfo.tags);

    /* Add Annotation Based on Confidence Value and filtered Tags */
    this.state.currentAssetAnnotations
      /*
       * @TODO : Refactor this before ProductHunt
       */
      .filter(
        (annotation: any) =>
          !this.state.hiddenAnnotations.has(annotation.options.annotationID) &&
          /* If no filters selected, should return true. This is to
              guard against some returning false on empty arrays */
          (this.state.filterArr.length === 0 ||
            /* Check if tag is present in filter (CASE-INSENSITIVE) */
            this.state.showSelected ===
              this.state.filterArr.some(filter =>
                invertedProjectTags[annotation.options.annotationTag]
                  .toLowerCase()
                  .includes(filter.toLowerCase())
              )) &&
          annotation.options.confidence >= this.state.confidence
      )
      .forEach((confidentAnnotation: any) => {
        /* Add It Onto Leaflet */
        const annotationToCommit = cloneDeep(confidentAnnotation);
        annotationToCommit.options.fillOpacity = this.state.annotationOptions.opacity;
        annotationToCommit.options.weight = !this.state.annotationOptions
          .isOutlined
          ? 0
          : confidentAnnotation.options.weight;

        this.annotationGroup.addLayer(annotationToCommit);
      });
  }

  /**
   * Check if a given asset should be visible given
   * the current settings
   * @param asset - asset object to check
   */
  private isAssetVisible() {
    /* Don't show annotated assets if annotatedAssetsHidden flag active */
    return !this.state.annotatedAssetsHidden;
  }

  /**
   * Handler for onImageChange - This function swaps image on leaflet canvas
   * as well as renders user-defined (if-any) annotation as LeafletLayerObjects
   * @param filename - URL of Asset
   */
  public selectAsset(asset: AssetAPIObject): void {
    /**
     * Check if there has been a reselection of asset, if so, we avoid
     * rescaling or map-fitting the current viewport to improve QoL
     */

    /* Checks if there is AssetReselection */
    const isAssetReselection = !(asset.assetUrl !== this.currentAsset.assetUrl);

    const videoElement = this.videoOverlay.getElement();
    if (!isAssetReselection) {
      this.setState({ currentAssetAnnotations: [] });
      this.annotationGroup.eachLayer(layer => {
        this.annotationGroup.removeLayer(layer);
      });
      this.updateMenuBarAnnotations();
      if (videoElement) {
        (videoElement as any).cancelVideoFrameCallback(
          this.state.currAnnotationPlaybackId
        );
      }
    }

    const initialSelect = Object.keys(this.currentAsset).length === 0;
    this.imagebarRef.highlightAsset(asset.assetUrl);

    /* Clear Previous Images' Annotation from Annotation Group */
    this.annotationGroup.clearLayers();
    /**
     * PLEASE REMOVE IN FORESEABLE FUTURE
     */
    (this.annotationGroup as any).tags = this.state.tagInfo.tags;

    if (asset.type === "image") {
      if (!this.map.hasLayer(this.imageOverlay)) {
        this.videoOverlay.remove();
        this.imageOverlay.addTo(this.map);
      }

      /* Set Selected Image */
      const selectedImage = new Image();
      /* Assign Image URL */
      this.imageOverlay.setUrl(asset.assetUrl);
      selectedImage.src = asset.assetUrl;

      selectedImage.onload = () => {
        this.imageOverlay.setBounds(
          new L.LatLngBounds([
            [0, 0],
            [selectedImage.height, selectedImage.width],
          ])
        );

        /* Update Current Asset with Image Metadata */
        this.currentAsset = {
          ...asset,
          metadata: {
            width: selectedImage.width,
            height: selectedImage.height,
          },
        };
        /* Set Centre Viewport */
        if (!isAssetReselection) {
          /* Work Around, Allowing Map to Zoom to Any Factor */
          this.map.setMinZoom(-5);
          /* Invalidate Previous Sizing */
          this.map.invalidateSize();
          /* Artificial Delay */
          setTimeout(() => {
            this.map.fitBounds(this.imageOverlay.getBounds(), {
              padding: new L.Point(20, 20),
            });
          }, 150);
          /* Reset to Default Zoom */
          this.map.setMinZoom(-3);
        }

        if (initialSelect) {
          this.setState({});
        }
      };

      /* Select background image in DOM */
      this.backgroundImg = document.querySelector(
        ".leaflet-pane.leaflet-overlay-pane img.leaflet-image-layer"
      );
    }
    if (asset.type === "video") {
      if (!this.map.hasLayer(this.videoOverlay)) {
        this.imageOverlay.remove();
        this.videoOverlay.addTo(this.map);
      }

      const selectedVideo = document.createElement("video");
      selectedVideo.setAttribute("src", asset.assetUrl);
      this.videoOverlay.setUrl(asset.assetUrl);

      selectedVideo.onloadedmetadata = () => {
        this.videoOverlay.setBounds(
          new L.LatLngBounds([
            [0, 0],
            [selectedVideo.videoHeight, selectedVideo.videoWidth],
          ])
        );

        /* Update Current Asset with Image Metadata */
        this.currentAsset = {
          ...asset,
          metadata: {
            width: selectedVideo.videoWidth,
            height: selectedVideo.videoHeight,
          },
        };

        if (videoElement) {
          videoElement.controls = true;
          videoElement.setAttribute("controlsList", "nofullscreen nodownload");
        }

        if (!isAssetReselection) {
          /* Work Around, Allowing Map to Zoom to Any Factor */
          this.map.setMinZoom(-5);
          /* Invalidate Previous Sizing */
          this.map.invalidateSize();
          /* Artificial Delay */
          setTimeout(() => {
            this.map.fitBounds(this.videoOverlay.getBounds(), {
              padding: new L.Point(20, 20),
            });
            /* Reset to Default Zoom */
            this.map.setMinZoom(-3);

            /** Set Focus */
            videoElement?.focus();
          }, 150);
        } else {
          /** Set Focus */
          videoElement?.focus();
        }
        if (initialSelect) {
          this.setState({});
        }
      };

      this.backgroundImg = document.querySelector(
        ".leaflet-pane.leaflet-overlay-pane video.leaflet-image-layer"
      );
    }
  }

  /**
   * Update annotations list in menu bar state
   * to current annotationGroup
   */
  public updateMenuBarAnnotations(): void {
    if (this.menubarRef.current !== null) {
      this.menubarRef.current.setAnnotations(this.annotationGroup);
    }
  }

  /**
   * Set currently selected tag to target tag using respective hash
   * - Used to select annotation tag and update menu bar from external
   *  components, where tag index is unknown
   * @param tagHash - Tag hash of tag to be selected
   */
  public selectAnnotationTagByHash(tagHash: number): void {
    /* Find tag index */
    const tagIndex = Object.values(this.state.tagInfo.tags).indexOf(tagHash);
    if (tagIndex !== -1) {
      /* If target tag in project tags, set data members */
      this.currentTag = tagIndex;
      /* Update menu bar */
      if (this.menubarRef.current !== null)
        this.menubarRef.current.setAnnotationTag(tagIndex);
    }
  }

  /**
   * Refresh project for
   * - Annotation Tag Changes
   * - Get Periodic Updates
   */
  private async refreshProject() {
    // await APIGetProjectAnnotatorAssets(this.project).then(result => {
    //   this.setState({
    //     assetList: result.data.assets,
    //     projectTags: result.data.tags,
    //   });
    //   /* Effect Annotation Changes */
    // });
    this.selectAsset(this.currentAsset);
  }

  /**
   * Add New Created Tag
   * - Callback for the Annotation level
   * - Updates the List of Project Tags when a new one is created in Annotation Select
   */
  public addNewTag(tagname: string, tagid: number): void {
    this.setState(prevState => {
      const updatedTags = { ...prevState.tagInfo.tags };
      updatedTags[tagname] = tagid;
      return {
        tagInfo: { modelHash: prevState.tagInfo.modelHash, tags: updatedTags },
      };
    });
  }

  /**
   * Disable All Handlers, Allowing for a single state only button management
   */
  public resetControls(): void {
    this.setUserState("None");
    /* this.handleDrawRectangle.disable();
    this.handleDrawPolygon.disable(); 
    this.handleRemoveAnnotation.disable(); */
    this.setSelectedAnnotation(null);
  }

  private renderProgress(amount: number): IToastProps {
    return {
      className: this.props.useDarkTheme ? "bp3-dark" : "",
      icon: "cloud-upload",
      message: (
        <ProgressBar
          className={"predict-prog"}
          intent={amount < 100 ? "primary" : "success"}
          value={this.currentAsset.type === "video" ? 1 : amount / 100}
        />
      ),
      onDismiss: (didTimeoutExpire: boolean) => {
        if (!didTimeoutExpire) {
          // user dismissed toast with click
          window.clearInterval(this.progressToastInterval);
        }
      },
      timeout: amount < 100 ? 0 : 600,
    };
  }

  /* Hotkey for Quick Annotation Selection */
  public renderHotkeys(): JSX.Element {
    return (
      <Hotkeys>
        {/* Hotkey Bindings for Annotations */}
        <Hotkey
          global={true}
          combo={"o"}
          label={"Open Folder"}
          onKeyDown={this.handleFileManagementOpen}
        />
        <Hotkey
          global={true}
          combo={"r"}
          label={"Re-Analyse"}
          onKeyDown={this.getInference}
        />
        <Hotkey
          global={true}
          combo={"b"}
          label={"Bulk Analysis"}
          onKeyDown={this.getInference}
        />
        <Hotkey
          global={true}
          combo={"esc"}
          label={"Exit Current Mode"}
          onKeyDown={this.resetControls}
        />
        <Hotkey
          global={true}
          combo={"h"}
          label={"Hide Annotations"}
          onKeyDown={() => {
            /* Allow Toggling of Layer Hiding */
            if (this.map.hasLayer(this.annotationGroup))
              this.map.removeLayer(this.annotationGroup);
            else this.map.addLayer(this.annotationGroup);
          }}
        />
        <Hotkey
          global={true}
          combo={"left"}
          label={"Load previous asset"}
          onKeyDown={() => this.switchAnnotation(true)}
        />
        <Hotkey
          global={true}
          combo={"right"}
          label={"Load previous asset"}
          onKeyDown={() => this.switchAnnotation(false)}
        />
        <Hotkey
          global={true}
          combo={"space"}
          label={"Play/Pause Video"}
          onKeyDown={this.handlePlayPauseVideoOverlay}
        />
        {Object.entries(this.state.tagInfo.tags).map(([tagname], idx) => {
          /* Only Perform Hotkey for First 9 Objects */
          if (idx > 9) return;

          // eslint-disable-next-line consistent-return
          return (
            <Hotkey
              key={tagname}
              global={true}
              combo={`${idx + 1}`}
              label={`Shortcut : ${tagname}`}
              onKeyDown={() => {
                this.currentTag = idx as number;
                if (this.menubarRef.current != null)
                  this.menubarRef.current.setAnnotationTag(idx);
              }}
            />
          );
        })}
      </Hotkeys>
    );
  }

  render(): JSX.Element {
    /* Prefix for Dynamic Styling of Collapsing Image List */
    const collapsedButtonTheme = this.props.useDarkTheme ? "" : "light-";
    const isCollapsed = this.state.imageListCollapsed ? "collapsed-" : "";

    /* Filter currently visible assets based on current settings */
    const visibleAssets = this.state.assetList.filter(() =>
      this.isAssetVisible()
    );

    /* Index of current asset */
    const currentIndex =
      this.state.assetList.findIndex(
        asset => asset.assetUrl === this.currentAsset.assetUrl
      ) + 1;
    return (
      <div>
        <Toaster {...this.state} ref={this.refHandlers.toaster} />
        <div className={"workspace"}>
          {/* Appends Styling Prefix if Image List is Collapsed */}
          <div
            className={[isCollapsed, "image-list"].join("")}
            id={"image-list"}
          >
            {this.state.imageListCollapsed && visibleAssets.length > 0 ? (
              <div className={"statistics"}>
                <p>{this.annotatedAssets} annotated</p>
                <ProgressBar
                  /**
                   * Since this component shows total statistics, use the full
                   * assetList instead of visibleAssets
                   */
                  value={this.annotatedAssets / this.state.assetList.length}
                  intent={
                    this.annotatedAssets / this.state.assetList.length === 1
                      ? "success"
                      : "primary"
                  }
                  animate={false}
                  stripes={false}
                  className="statistic-progress-bar"
                />
                <p>
                  {currentIndex <= 0 ? "-" : currentIndex} of{" "}
                  {this.state.assetList.length}
                </p>
              </div>
            ) : null}
            <Button
              className={[collapsedButtonTheme, "collapse-button"].join("")}
              large
              icon={this.state.imageListCollapsed ? "caret-up" : "caret-down"}
              onClick={() => {
                this.setState(prevState => ({
                  imageListCollapsed: !prevState.imageListCollapsed,
                }));
              }}
            />
            <div
              className={[collapsedButtonTheme, "collapse-button-effect"].join(
                ""
              )}
            />
            {/* Appends Styling Prefix */}
            <Card
              className={[isCollapsed, "image-bar"].join("")}
              id={"image-bar"}
            >
              <ImageBar
                ref={ref => {
                  this.imagebarRef = ref;
                }}
                /* Only visible assets should be shown */
                assetList={visibleAssets}
                callbacks={{ selectAssetCallback: this.selectAsset }}
                {...this.props}
              />
            </Card>
          </div>

          {/* Expands when Image Bar is Collapsed */}
          <div
            className={
              this.state.imageListCollapsed
                ? "expanded-annotator-space"
                : "annotator-space"
            }
          >
            {/* Non-Ideal State Render */}
            {Object.keys(this.currentAsset).length === 0 ? (
              <Card className={"annotator-non-ideal"}>
                <div className="bp3-non-ideal-state">
                  <div className="bp3-non-ideal-state-visual">
                    <span>
                      <Icon icon="media" iconSize={60} />
                    </span>
                  </div>
                  <h4 className="bp3-heading bp3-text-muted">
                    Select an Image to Annotate
                  </h4>
                </div>
              </Card>
            ) : null}
            {/* End Non-Ideal State Render */}
            <Card className={"main-annotator"}>
              <div id="annotation-map" className={"style-annotator"} />
              {this.backgroundImg ? (
                <div className="annotator-settings-button">
                  <AnnotatorSettings
                    annotationOptions={this.state.annotationOptions}
                    callbacks={{
                      setAnnotatedAssetsHidden: this.setAnnotatedAssetsHidden,
                      setAnnotationOutline: this.setAnnotationOutline,
                      setAnnotationOpacity: this.setAnnotationOpacity,
                    }}
                  />
                </div>
              ) : null}
            </Card>
          </div>
          <div className={"annotator-controls"}>
            <AnnotationMenu
              ref={this.menubarRef}
              projectTags={this.state.tagInfo.tags}
              userEditState={this.state.userEditState}
              changesMade={this.state.changesMade}
              uiState={this.state.uiState}
              predictDone={this.state.predictDone}
              predictTotal={this.state.predictTotal}
              hiddenAnnotations={this.state.hiddenAnnotations}
              confidence={this.state.confidence}
              filterArr={this.state.filterArr}
              showSelected={this.state.showSelected}
              useDarkTheme={this.props.useDarkTheme}
              callbacks={{
                ResetControls: this.resetControls,
                OpenFileManagement: this.handleFileManagementOpen,
                SetAnnotationTag: this.setAnnotationTag,
                OpenAdvancedSettings: this.handleAdvancedSettingsOpen,
                SetAnnotationVisibility: this.setAnnotationVisibility,
                GetInference: this.getInference,
                ToggleConfidence: this.toggleConfidence,
                /* Used by TagSelector */
                SetFilterArr: this.setFilterArr,
                ToggleShowSelected: this.toggleShowSelected,
              }}
            />
            {/* File Management Modal */}
            {this.state.fileManagementOpen ? (
              <FileModal
                onClose={this.handleFileManagementClose}
                isOpen={true}
                allowUserClose={true}
                callbacks={{
                  RefreshProject: this.refreshProject,
                  UpdateImage: this.updateImage,
                }}
                {...this.props}
              />
            ) : null}
            {/* Tag Management Modal */}
            {this.state.advancedSettingsOpen ? (
              <SettingsModal
                inferenceOptions={this.state.inferenceOptions}
                onClose={
                  !this.state.advancedSettingsOpen
                    ? this.handleAdvancedSettingsOpen
                    : this.handleAdvancedSettingsClose
                }
                isOpen={true}
                allowUserClose={true}
                callbacks={{
                  HandleChangeInSettings: this.handleChangeInAdvancedSettings,
                }}
                {...this.props}
              />
            ) : null}
          </div>
        </div>
      </div>
    );
  }
}
