import React, { useState, useRef, useEffect } from "react";
import {
  Button,
  Rows,
  Text,
  Title,
  Select,
  Alert,
  ProgressBar,
  FileInput,
} from "@canva/app-ui-kit";

import { upload } from "@canva/asset";
import {
  addElementAtPoint,
  getCurrentPageContext,
  setCurrentPageBackground,
} from "@canva/design";
import { findFonts } from "@canva/asset";
import { requestFontSelection } from "@canva/asset";

import { CanvaError } from "@canva/error";
import * as styles from "styles/components.css";
import axios from "axios";
import imageCompression from "browser-image-compression";

import { professionsByCategory } from "./data/professionsByCategory";
import { Job } from "./types/jobLists";

export const DOCS_URL = "https://www.canva.dev/docs/apps/";

export const App = () => {
  // 상수 정의
  const ESTIMATED_TIME_TO_COMPLETE_IN_MS = 10 * 1000; // 예상 완료 시간 (10초)
  const INTERVAL_DURATION_IN_MS = 100; // 프로그레스 바 업데이트 간격 (0.1초)
  const POLLING_INTERVAL_IN_MS = 3000; // 3초마다 상태 확인
  const TOTAL_PROGRESS_PERCENTAGE = 100; // 총 진행률 (100%)

  // 상태 변수들
  const [isLoading, setIsLoading] = useState(false); // 로딩 상태
  const [isCanceled, setIsCanceled] = useState(false); // 취소 상태
  const [progress, setProgress] = useState(0); // 현재 진행률
  const [jobCategoryList, setJobCategoryList] = useState<Job[]>([]); // 전체 직업 카테고리 목록 배열
  const [uploadedImage, setUploadedImage] = useState<string | null>(null); // 업로드된 이미지 URL
  const [selectedFile, setSelectedFile] = useState<File | null>(null); // 업로드된 이미지 객체
  const [userJobData, setUserJobData] = useState<string>(""); // 선택된 직업
  const [selectedCategoryJobList, setSelectedCategoryJobList] = useState<Job[]>( // 선택된 카테고리 직업 목록 배열
    [],
  );
  const [backgroundImage, setBackgroundImage] = useState<boolean>(false);

  // job-category 데이터 로드
  useEffect(() => {
    const jobListArr: Job[] = professionsByCategory.map((item, index) => ({
      index: index,
      value: item.category,
      label: item.category,
    }));
    setJobCategoryList(jobListArr);
  }, []);

  // useRef를 사용하여 interval ID 관리
  const intervalIdRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const pollingIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // 배경 이미지 설정
  useEffect(() => {
    const addBgImage = async () => {
      const { fonts } = await findFonts();
      console.log(fonts); // => [ { name: "Arial", ... }]

      const fontResponse = await requestFontSelection();
      console.log(fontResponse);
      const bgUrl = "https://swap-image.s3.us-east-1.amazonaws.com/bg.png";

      const result = await upload({
        type: "image",
        mimeType: "image/png",
        url: bgUrl,
        thumbnailUrl: bgUrl,
        aiDisclosure: "app_generated",
      });

      if (!result || !result.ref) {
        throw new Error(
          "배경 이미지 업로드 결과가 유효하지 않습니다. result.ref: " +
            result?.ref,
        );
      }

      await setCurrentPageBackground({
        asset: {
          type: "image",
          ref: result.ref,
        },
      });
      localStorage.setItem("backgroundImageSet", "true");
      setBackgroundImage(true);
    };
    const isBackgroundImageSet = localStorage.getItem("backgroundImageSet");

    if (isBackgroundImageSet !== "true") {
      addBgImage();
    }
  }, [backgroundImage]);

  // 로딩 프로그레스 바 리셋 함수
  const resetLoadingProgressbar = () => {
    console.log("resetLoadingProgressbar 실행 ");
    // interval이 설정되어 있다면 클리어
    if (intervalIdRef.current !== undefined) {
      clearInterval(intervalIdRef.current); //메모리 누수 방지
      intervalIdRef.current = undefined;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = undefined;
    }
    setIsLoading(false); // 로딩 상태 해제
    setProgress(0); // 진행률 초기화
  };

  function makeUniqueID() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  const formatFileName = (jobName: string) => {
    const formattedJobName = jobName.toLowerCase().replace(/\s+/g, "");
    return `previous-${formattedJobName}-${makeUniqueID()}.jpg`;
  };

  const renameFile = (originalFile: File, formatFileName: string) => {
    return new File([originalFile], formatFileName, {
      type: originalFile.type,
      lastModified: originalFile.lastModified,
    });
  };
  // 이미지 압축 함수
  const compressImage = async (file: File) => {
    const options = {
      maxSizeMB: 1, // 이미지의 최대 크기 (MB)
      maxWidthOrHeight: 1920, // 최대 너비 또는 높이
      useWebWorker: true, // 웹 워커를 사용하여 메인 스레드 차단 방지
    };
    try {
      const compressedFile = await imageCompression(
        renameFile(file, formatFileName(userJobData)),
        options,
      );
      console.log("Original file size:", file.size / 1024 / 1024, "MB");
      console.log(
        "Compressed file size:",
        compressedFile.size / 1024 / 1024,
        "MB",
      );
      return compressedFile;
    } catch (error) {
      console.error("Error compressing image:", error);
      return file;
    }
  };

  // PUT 메서드 API Gateway에 pre-signed-url 요청 보내기 함수
  const sendRequest = async (objectName: string) => {
    try {
      const bucketName = process.env.REACT_APP_BUCKET_NAME;
      const url = `https://ql117fdgq0.execute-api.ap-northeast-1.amazonaws.com/default/${bucketName}?object_name=${encodeURIComponent(objectName)}&content_type=image/jpeg&expiration=3600`;

      const response = await axios.put(url, {
        // PUT 요청으로 변경, 데이터는 빈 객체로 전달
        headers: {
          "Content-Type": "application/json", // 요청의 콘텐츠 타입
        },
      });

      return response.data.url; // pre-signed URL 반환
    } catch (error) {
      console.error("Error sending request:", error);
      return null;
    }
  };

  // S3에 이미지 업로드 함수
  const uploadToS3 = async (
    file: File,
    presignedUrl: string,
  ): Promise<boolean> => {
    try {
      console.log("upload file : ", file);
      const response = await axios.put(presignedUrl, file, {
        headers: {
          "Content-Type": file.type, // 파일의 MIME 타입을 Content-Type으로 설정
        },
      });

      if (response.status === 200) {
        console.log("Successfully uploaded to S3");
        return true; // 업로드 성공
      } else {
        console.error("Error uploading to S3:", response);
        return false;
      }
    } catch (error) {
      console.error("Error uploading to S3:", error);
      return false;
    }
  };

  /**
   * 이미지 포맷 변환
   * @param file 업로드된 File 객체
   * @param targetFormat 변환할 이미지 포맷 (jpeg, png, webp)
   * @returns 변환된 이미지 Blob 객체
   */
  const convertImageFormat = async (
    file: File,
    targetFormat: "jpeg" | "png" | "webp",
  ): Promise<Blob> => {
    const img = new Image();
    img.src = URL.createObjectURL(file);

    return new Promise<Blob>((resolve, reject) => {
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          reject(new Error("Canvas context를 가져올 수 없습니다."));
          return;
        }

        ctx.drawImage(img, 0, 0);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob); // 변환된 이미지 Blob 반환
            } else {
              reject(new Error("이미지 변환에 실패했습니다."));
            }
            URL.revokeObjectURL(img.src); // Blob URL 해제
          },
          `image/${targetFormat}`, // 변환할 포맷
          0.9, // 품질 설정 (JPEG/WebP의 경우)
        );
      };

      img.onerror = () => {
        reject(new Error("이미지 로드 실패"));
      };
    });
  };

  /**
   * 실제 이미지 포맷 확인 및 변환
   * @param file 업로드된 File 객체
   * @param contentType HTTP Content-Type 헤더
   */
  const validateAndConvertImage = async (
    file: File,
    contentType: string,
  ): Promise<void> => {
    try {
      // MIME 타입에서 포맷 추출
      const formatFromContentType = contentType.split("/")[1]?.toLowerCase();

      // 파일 확장자 추출
      const fileExtension = file.name.split(".").pop()?.toLowerCase();

      console.log(`Content-Type Format: ${formatFromContentType}`);
      console.log(`File Extension Format: ${fileExtension}`);

      // 유효한 포맷 리스트
      const validFormats: string[] = ["jpeg", "png", "webp"];

      // Blob에서 MIME 타입 추출
      const blobUrl = URL.createObjectURL(file);
      const img = new Image();
      img.src = blobUrl;

      const actualFormat = await new Promise<string>((resolve, reject) => {
        img.onload = () => {
          const mimeType = file.type.split("/")[1]?.toLowerCase() || "";
          resolve(mimeType);
          URL.revokeObjectURL(blobUrl); // Blob URL 해제
        };
        img.onerror = () => {
          reject(new Error("이미지 로드에 실패했습니다."));
        };
      });

      console.log(`Actual Format: ${actualFormat}`);

      // 타겟 포맷 결정
      let targetFormat: "jpeg" | "png" | "webp" | undefined;
      if (validFormats.includes(formatFromContentType as any)) {
        targetFormat = formatFromContentType as "jpeg" | "png" | "webp";
      } else if (validFormats.includes(fileExtension || "")) {
        targetFormat = formatFromContentType as "jpeg" | "png" | "webp";
      }

      console.log(`Target Format: ${targetFormat}`);

      if (!validFormats.includes(actualFormat)) {
        throw new Error(`지원되지 않는 이미지 포맷: ${actualFormat}`);
      }

      // 포맷 변환 필요 여부 확인
      if (actualFormat !== targetFormat) {
        console.log(`이미지를 ${targetFormat}로 변환이 필요합니다.`);
        if (targetFormat) {
          const convertedBlob = await convertImageFormat(file, targetFormat);
          console.log("이미지 변환 성공:", convertedBlob);
        }
      } else {
        console.log("이미지 변환이 필요하지 않습니다.");
      }
    } catch (error) {
      console.error("Error processing the image:", error);
    }
  };

  // 테스트를 위한 프로그레스 바 설정. 추가된 useEffect와 함수
  useEffect(() => {
    if (isLoading) {
      const progressInterval = setInterval(() => {
        setProgress((prevProgress) => {
          const nextProgress = prevProgress + 10; // 10%씩 증가
          if (nextProgress >= 100) {
            clearInterval(progressInterval); // 100%가 되면 정지
            setProgress(100);
            setIsLoading(false); // 로딩 상태 해제

            addElementsToCanvas().catch((e) => {
              console.log(e);
            }); // 요소 추가
          }
          return nextProgress;
        });
      }, 500); // 0.5초 간격으로 업데이트

      return () => clearInterval(progressInterval); // 컴포넌트 언마운트 시 정리
    }
  }, [isLoading]);

  const addElementsToCanvas = async () => {
    try {
      // 이미지 업로드 URL 확인. --> 실제 받아온 이미지 url로 바꿔야 함
      const uploadUrl =
        "https://d3es8s6of2yyy0.cloudfront.net/swapped_image_minver.jpg";
      const textBox =
        "https://swap-image.s3.us-east-1.amazonaws.com/text_box.png";
      const imageFileResponse = await fetch(uploadUrl);
      const contentType = imageFileResponse.headers.get("Content-Type");

      if (!contentType) {
        throw new Error("Failed to check Content-Type in header.");
      }

      const blob = await imageFileResponse.blob();
      const fileName = uploadUrl.split("/").pop() || "downloaded_file";
      const imageFile = new File([blob], fileName, { type: contentType });

      validateAndConvertImage(imageFile, contentType);

      // contentType에서 이미지 MIME 타입만 허용
      const validImageMimeTypes: string[] = [
        "image/png",
        "image/jpeg",
        "image/webp",
      ];
      if (!validImageMimeTypes.includes(contentType)) {
        throw new Error(`지원되지 않는 이미지 타입: ${contentType}`);
      }

      const result = await upload({
        type: "image",
        mimeType: contentType as "image/png" | "image/jpeg" | "image/webp",
        url: uploadUrl,
        thumbnailUrl: uploadUrl,
        aiDisclosure: "app_generated",
      });
      const textBoxResult = await upload({
        type: "image",
        mimeType: "image/png",
        url: textBox,
        thumbnailUrl: textBox,
        aiDisclosure: "app_generated",
      });

      if (!result || !result.ref) {
        throw new Error(
          "업로드 결과가 유효하지 않습니다. result.ref: " + result?.ref,
        );
      }
      const context = await getCurrentPageContext();

      if (!context.dimensions) {
        console.warn("The current design does not have dimensions");
        return;
      }
      const canvasWidth = context.dimensions.width;
      const canvasHeight = context.dimensions.height;

      const textWidth = canvasWidth;
      const imageWidth = 500;
      const imageHeight = 500;
      const gapBetweenImageAndText = 60;

      const groupLeft = (canvasWidth - imageWidth) / 2 + 30;
      const groupTop = (canvasHeight - imageHeight) / 2;

      console.log(context.dimensions.width);
      // 생성된 이미지를 캔버스에 추가함
      try {
        console.log("addElementAtPoint 호출 시작");

        await addElementAtPoint({
          type: "group",
          children: [
            {
              type: "image",
              ref: textBoxResult.ref,
              altText: {
                text: "Example image",
                decorative: false,
              },
              width: textWidth + 60,
              height: "auto",
              top: imageHeight + gapBetweenImageAndText / 2,
              left: 0,
            },
            {
              type: "image",
              ref: result.ref,
              altText: {
                text: "Example image",
                decorative: false,
              },
              width: imageWidth,
              height: imageHeight,
              top: 0,
              left: groupLeft,
            },

            {
              type: "text",
              children: [
                "You are a passionate nurse who approaches patients with care and compassion, always striving to do your best. Even in challenging situations, you remain calm and composed. Your smooth communication with patients and their families has earned their trust.  You are not just a caregiver providing treatment; you are a source of hope and courage for your patients. You sensitively respond to even the smallest changes in their condition, finding joy in their happiness and recovery. You are a true healthcare professional. ",
              ],
              width: textWidth,
              top: imageHeight + gapBetweenImageAndText,
              left: 30,
              fontSize: 25,
              color: "#ffffff",
            },
          ],
        });
        console.log("addElementAtPoint 호출 성공");
      } catch (error) {
        console.error("addElementAtPoint 에러:", error);
        if (error instanceof CanvaError) {
          console.log("CanvaError 코드:", error.code);
        }
      }
    } catch (error) {
      console.error("addElementsToCanvas 함수 실패:", error);

      if (error instanceof CanvaError) {
        console.log("CanvaError 발생:", error.code);
        switch (error.code) {
          case "permission_denied":
            console.log("권한 부족: 요청이 거부되었습니다.");
            break;
          case "user_offline":
            console.log("네트워크가 연결되지 않았습니다.");
            break;
          case "timeout":
            console.log("요청 시간이 초과되었습니다.");
            break;
          default:
            console.log("알 수 없는 CanvaError:", error.message);
            break;
        }
      } else {
        console.log("알 수 없는 에러:", error);
      }
    }
  };

  // handleUploadClickBtn 수정
  const handleUploadClickBtn = () => {
    if (selectedFile !== null && userJobData !== "") {
      setIsLoading(true); // 로딩 상태 시작
      setProgress(0); // 프로그레스바 초기화
    }
  };

  // 이미지 업로드 버튼 클릭 핸들러
  // const handleUploadClickBtn = () => {
  //   if (selectedFile !== null && userJobData !== "") {
  //     processUploadedImage(selectedFile);
  //   }
  // };

  // 완성된 이미지 받아오기
  const fetchProcessedImage = async () => {
    try {
      // const response = await axios.get(
      //   "https://cyjzamjs70.execute-api.ap-northeast-2.amazonaws.com/uploadOmega",
      // ); // 이미지 상태 확인

      //실제로는 현재 이미지에 대한 return 값만 받아오도록 수정해야함
      // setFetchedImage(response.data[1].Image); // 이미지 URL 업데이트
      resetLoadingProgressbar(); // 프로그레스 바 종료
    } catch (error) {
      console.error("Error fetching processed image:", error);
    }
  };

  // 이미지 업로드 함수
  const processUploadedImage = async (file: File) => {
    setIsLoading(true);
    if (isCanceled) {
      setIsCanceled(false);
    }
    setProgress(0);

    // 이미지 압축
    const compressedFile = await compressImage(file);
    // Pre-signed URL 요청
    const presignedUrl = await sendRequest(compressedFile.name);

    if (presignedUrl) {
      // 프로그레스 바 업데이트 횟수 계산
      const totalNumberOfProgressBarUpdates = Math.ceil(
        ESTIMATED_TIME_TO_COMPLETE_IN_MS / INTERVAL_DURATION_IN_MS,
      );
      let updateCount = 1;

      // 프로그레스 바 업데이트를 위한 interval 설정
      intervalIdRef.current = setInterval(() => {
        // 진행률 계산 및 업데이트
        setProgress((prevProgress) => {
          const nextProgressValue =
            prevProgress +
            Math.ceil(
              TOTAL_PROGRESS_PERCENTAGE / totalNumberOfProgressBarUpdates,
            );
          return Math.min(nextProgressValue, TOTAL_PROGRESS_PERCENTAGE);
        });
        updateCount += 1;
      }, INTERVAL_DURATION_IN_MS);

      // S3에 이미지 업로드
      const uploadSuccess = await uploadToS3(compressedFile, presignedUrl);
      if (uploadSuccess) {
        console.log("Polling 시작"); // Polling 시작 확인

        // 업로드 성공 시 이미지가 준비될 때까지 주기적으로 상태 확인 (롱폴링)
        pollingIntervalRef.current = setInterval(
          fetchProcessedImage,
          POLLING_INTERVAL_IN_MS,
        );
      } else {
        // 업로드 및 상태 확인 완료 후 프로그레스 바 초기화
        resetLoadingProgressbar();
      }
    } else {
      // Pre-signed URL 요청 실패 시 알림 및 프로그레스 바 초기화
      // alert("Pre-signed URL을 가져오는데 실패했습니다.");
      alert("Got an Error. Please try again.");
      resetLoadingProgressbar();
    }
  };

  // 작업 취소 핸들러
  const cancelTask = () => {
    setIsCanceled(true);
    resetLoadingProgressbar();
  };

  // 작업 취소 alert 언마운트
  useEffect(() => {
    if (isCanceled) {
      const timer = setTimeout(() => {
        setIsCanceled(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isCanceled]);

  // 사용자 job category 선택값 저장
  const handleCategoryChange = (value: string) => {
    const jobArr: string[] =
      professionsByCategory.find((item) => item.category == value)?.jobs || [];

    const jobArrList: Job[] = jobArr.map((item, index) => ({
      index: index,
      value: item,
      label: item,
    }));

    setSelectedCategoryJobList(jobArrList);
  };

  // 업로드된 이미지 처리
  const handleAcceptedFiles = (files: File[]) => {
    if (files.length > 0) {
      console.log("Accepted Image:", files[0]);
      setSelectedFile(files[0]); // 업로드된 이미지 객체 저장

      const imageURL = URL.createObjectURL(files[0]);
      setUploadedImage(imageURL); // 업로드 된 이미지 로컬 미리보기 URL
    }
  };

  // 로딩 중일 때 보여줄 UI
  if (isLoading) {
    return (
      <div className={styles.scrollContainer}>
        <Rows spacing="3u">
          <Rows spacing="2u">
            <Title alignment="center" size="small">
              Processing images.
            </Title>
            <Alert tone="positive"> Image upload successfully completed.</Alert>
            <ProgressBar
              value={progress}
              size="medium"
              ariaLabel={"loading progress bar"}
            />
            <Text alignment="center" tone="tertiary" size="small">
              Drawing your future... Please wait a moment...
            </Text>
          </Rows>
          <Button variant="secondary" onClick={cancelTask}>
            취소
          </Button>
          <br></br>
        </Rows>
      </div>
    );
  }

  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="2u">
        <Text>1. Please choose the future self you aspire to be.</Text>
        <Select
          options={jobCategoryList}
          onChange={handleCategoryChange}
          placeholder="Select a job category"
          stretch
        />
        {selectedCategoryJobList.length > 0 && (
          <Select
            options={selectedCategoryJobList}
            onChange={(selectedJob) => setUserJobData(selectedJob)}
            placeholder="Select your profession job"
            stretch
          />
        )}
        <br></br>
        <Text>2. Please upload a picture that shows your face well.</Text>
        <FileInput
          accept={["image/png", "image/jpeg"]}
          onDropAcceptedFiles={handleAcceptedFiles}
        />
        {uploadedImage && (
          <div
            style={{
              width: "100%", // 부모 컨테이너 너비 설정
              textAlign: "center",
            }}
          >
            <img
              // src="https://dnvefa72aowie.cloudfront.net/business-profile/bizPlatform/profile/40388181/1674021254765/MWJlMWNjOGNiMDMzMzE0ZTUwM2ZiZTllZjJkOTZiMGViYTgzNDQxNTE0YWY4ZDU0ZWI3MWQ1N2MzMWU5ZTdmYS5qcGc=.jpeg?q=95&s=1440x1440&t=inside"
              src={uploadedImage}
              alt="Processed"
              style={{
                width: "50%",
              }}
            />
          </div>
        )}
        <br></br>
        <br></br>
        <Button variant="primary" onClick={handleUploadClickBtn} stretch={true}>
          Creating an Image
        </Button>

        {isCanceled && (
          <Alert tone="info"> The operation has been canceled.</Alert>
        )}
      </Rows>
    </div>
  );
};
